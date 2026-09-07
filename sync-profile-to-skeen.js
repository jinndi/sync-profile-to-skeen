/**
 * Plugin for syncing profiles from GUI.for.SingBox to SKeen
 */

const PORT = 52777

/** @type {EsmPlugin} */
export default async (Plugin) => {
  const onRun = async () => {
    try {
      if (typeof Plugins === 'undefined') {
        Plugins.message.error('Plugins API not available')
        return
      }
      const store = Plugins.useProfilesStore()
      if (!store || !store.profiles) {
        Plugins.message.error('Profiles store not available')
        return
      }
      if (store.profiles.length === 0) {
        Plugins.message.error('Create profile first')
        return
      }
      const profile = store.profiles.length === 1
        ? store.profiles[0]
        : await Plugins.picker.single('Select profile', 
          store.profiles.map(p => ({ label: p.name, value: p })), [store.profiles[0]]
      )
      await Share(Plugins.deepClone(profile))
    } catch (e) {
      Plugins.message.error('Error: ' + (e.message || String(e)))
    }
  }

  const Share = async (profile) => {
    try {
      await transformLocalRuleset(profile)
      const ips = await getIPAddress()

      const urls = ips.map(ip => `http://${ip}:${PORT}`)
      let config = await Plugins.generateConfig(profile, true)

      const onSettingsConfirm = async (settingsOptions, configRef) => {
        ensureConfig(configRef, settingsOptions)
        const { close } = await Plugins.StartServer('0.0.0.0:' + PORT, Plugin.id, async (req, res) => {
          res.end(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(configRef, null, 2))
        })
        return close
      }

      const options = await openCombinedModal(ips, urls, config, onSettingsConfirm)
      if (!options) {
        return
      }
    } catch (e) {
      Plugins.message.error('Share error: ' + (e.message || String(e)))
    }
  }

  function ensureConfig(config, options) {
    config.$schema = "https://sing-box.sagernet.org/schema.json"
    if (!config.dns) config.dns = { servers: [], rules: [] }
    if (!config.dns.servers) config.dns.servers = []
    if (!config.dns.rules) config.dns.rules = []
    if (!config.inbounds) config.inbounds = []
    if (!config.route) config.route = { rules: [] }
    if (!config.route.rules) config.route.rules = []

    const fakeip = config.dns.servers.find(s => s.type === 'fakeip')
    if (fakeip) {
      if (fakeip.inet4_range) fakeip.inet4_range = '198.18.0.0/15'
      if (options.ipv6Support && fakeip.inet6_range) delete fakeip.inet6_range
      else fakeip.inet6_range = 'fc00::/18'
    }
    config.dns.reverse_mapping = options.dnsReverseMapping || false
    const strategy = options.ipv6Support ? 'prefer_ipv4' : 'ipv4_only'
    config.dns.strategy = strategy
    config.dns.rules.forEach(r => { if (r.strategy) r.strategy = strategy })
    config.route.rules.forEach(r => { if (r.strategy) r.strategy = strategy })

    const tags = config.inbounds.map(i => i.tag)
    if (['redirect', 'hybrid'].includes(options.firewallMode) && !tags.includes('redirect-in')) {
      config.inbounds.push({ 
        type: 'redirect', 
        tag: 'redirect-in', 
        listen: '::', 
        listen_port: 65081
      })
    }
    if (['tproxy', 'hybrid'].includes(options.firewallMode) && !tags.includes('tproxy-in')) {
      config.inbounds.push({
        type: 'tproxy', 
        tag: 'tproxy-in', 
        listen: '::', 
        listen_port: 65082,
        ...(options.firewallMode === 'hybrid' ? { network: 'udp' } : {})
      })
    }
    if (options.dnsInbound.enable && !tags.includes('dns-in')) {
      config.inbounds.push({ 
        type: 'direct', 
        tag: 'dns-in', 
        listen: '::', 
        listen_port: options.dnsInbound.port 
      })
    }

    config.inbounds.filter(i => i.type === 'tun').forEach(tun => { 
      tun.auto_route = false
    })

    const naiveTLSKeys = ['enabled', 'server_name', 'ech']
    const filteredOutbounds = []

    for (const o of config.outbounds) {
      if (o.server === '127.0.0.1' || o.server === 'localhost') continue
      if (o.flow === 'xtls-rprx-vision-udp443') continue
      if (o.tls?.enabled && o.tls?.insecure) continue

      if (o.type === 'naive' && o.tls) {
        o.tls = Object.fromEntries(
          Object.entries(o.tls).filter(([k]) => naiveTLSKeys.includes(k))
        )
      }

      if (o.type === 'vless' && o.tls?.reality && !o.tls?.utls?.enabled) {
        o.tls = { 
          ...o.tls, 
          utls: { 
            enabled: true, 
            fingerprint: 'chrome' 
          } 
        }
      }

      if (o.type === 'selector') {
        o.interrupt_exist_connections = true
      }

      filteredOutbounds.push(o)
    }

    config.outbounds = filteredOutbounds

    let changed = true
    while (changed) {
      const beforeCount = config.outbounds.length
      const validTags = new Set(config.outbounds.map(o => o.tag))

      config.outbounds = config.outbounds.filter(o => {
        if (['selector', 'urltest'].includes(o.type) && o.outbounds) {
          o.outbounds = o.outbounds.filter(tag => validTags.has(tag) || ['direct', 'block'].includes(tag))

          return o.outbounds.length > 0
        }
        return true
      })

      changed = config.outbounds.length !== beforeCount
    }

    const sniffIdx = config.route.rules.findIndex(r => r.action === 'sniff')
    const newSniff = { action: 'sniff' }
    if (sniffIdx === -1) config.route.rules.unshift(newSniff)
    else {
      if (Object.hasOwn(config.route.rules[sniffIdx], 'inbounds')) delete config.route.rules[sniffIdx].inbounds
      config.route.rules[sniffIdx] = { ...newSniff, ...config.route.rules[sniffIdx] }
    }

    const hijackIdx = config.route.rules.findIndex(r => r.action === 'hijack-dns')
    const newHijack = { 
      type: 'logical', 
      mode: 'or', 
      rules: [
        { port: 53 }, 
        { protocol: 'dns' }
      ], 
      action: 'hijack-dns' 
    }
    if (hijackIdx !== -1) config.route.rules[hijackIdx] = newHijack
    else {
      const si = config.route.rules.findIndex(r => r.action === 'sniff')
      config.route.rules.splice(si !== -1 ? si + 1 : 0, 0, newHijack)
    }
  }

  async function transformLocalRuleset(profile) {
    const rulesetsStore = Plugins.useRulesetsStore()
    for (const ruleset of profile.route.rule_set) {
      if (ruleset.type === 'local') {
        const r = rulesetsStore.getRulesetById(ruleset.path)
        if (r) {
          if (r.type === 'Http') {
            ruleset.type = 'remote'
            ruleset.url = r.url
            ruleset.path = ''
          } else if (['File', 'Manual'].includes(r.type) && r.format === 'source') {
            const rules = JSON.parse(await Plugins.ReadFile(r.path)).rules
            ruleset.type = 'inline'
            ruleset.rules = JSON.stringify(rules)
            ruleset.url = ruleset.path = ''
          }
        }
      }
    }
  }

  function isPrivateIP(ip) {
    const parts = ip.split('.')
    if (parts.length !== 4) return false
    const first = parseInt(parts[0], 10)
    const second = parseInt(parts[1], 10)
    const fourth = parseInt(parts[3], 10)
    if (first === 255 || fourth === 1 || fourth === 255) return false
    if (first === 10) return true
    if (first === 172 && second >= 16 && second <= 31) return true
    if (first === 192 && second === 168) return true
    return false
  }

  async function getIPAddress() {
    const os = Plugins.useEnvStore().env.os
    const cmd = { windows: 'ipconfig', linux: 'ip', darwin: 'ifconfig' }[os]
    const args = { windows: [], linux: ['a'], darwin: [] }[os]
    const text = await Plugins.Exec(cmd, args, { Convert: os === 'windows' })
    const matches = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || []
    const ips = matches.filter(isPrivateIP)
    const priority = ip => ip.startsWith('192.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3
    return [...new Set(ips)].sort((a, b) => priority(a) - priority(b))
  }

  async function openCombinedModal(ips, urls, configRef, onSettingsConfirm) {
    if (typeof Vue === 'undefined') {
      Plugins.message.error('Vue runtime not available')
      return null
    }

    return new Promise((resolve) => {
      let closeServer = null
      let currentStep = 'settings'
      let pendingOptions = null

      const { ref, h, resolveComponent, defineComponent } = Vue

      const combinedModal = defineComponent({
        setup(_, { expose }) {
          const step = ref('settings')
          const firewallMode = ref('tproxy')
          const firewallModeOptions = [
            { label: 'Redirect', value: 'redirect' },
            { label: 'TProxy', value: 'tproxy' },
            { label: 'Hybrid', value: 'hybrid' },
            { label: 'Not add', value: 'none' }
          ]
          const ipv6Support = ref(false)
          const enableOptions = [
            { label: 'Disabled', value: false },
            { label: 'Enabled', value: true }
          ]
          const dnsInbound = ref({ enable: false, port: 60053 })
          const dnsReverseMapping = ref(false)
          const showCodeModal = ref(false)
          const editedConfig = ref('')

          const confirmSettings = async () => {
            const options = {
              firewallMode: firewallMode.value,
              ipv6Support: ipv6Support.value,
              dnsInbound: dnsInbound.value,
              dnsReverseMapping: dnsReverseMapping.value
            }
            pendingOptions = options
            currentStep = 'share'
            step.value = 'share'
            if (onSettingsConfirm) {
              try { closeServer = await onSettingsConfirm(options, configRef) }
              catch (e) { Plugins.message.error('Server: ' + (e.message || String(e))) }
            }
          }

          const onSettingsCancel = () => {
            resolve(null)
            modal.close()
          }

          const copy = (text) => {
            const ta = document.createElement('textarea')
            ta.value = text
            document.body.appendChild(ta)
            ta.select()
            document.execCommand('copy')
            document.body.removeChild(ta)
            Plugins.message.success('Copied!')
          }

          const copyConfigUrl = () => { urls?.length ? copy(urls.join('\n')) : Plugins.message.error('No URLs') }
          const copyConfigJson = () => { copy(JSON.stringify(configRef, null, 2)) }

          const openCodeModal = () => {
            editedConfig.value = JSON.stringify(configRef, null, 2)
            showCodeModal.value = true
          }

          const saveEditedConfig = () => {
            try {
              const parsed = JSON.parse(editedConfig.value)
              Object.assign(configRef, parsed)
              showCodeModal.value = false
              Plugins.message.success('Configuration updated')
            } catch (e) {
              Plugins.message.error('Invalid JSON: ' + (e.message || String(e)))
            }
          }

          expose({
            modalSlots: {
              toolbar: () => [
                h(
                  resolveComponent('Button'),
                  {
                    type: 'text',
                    icon: 'close',
                    onClick: () => {
                      if (currentStep === 'share') {
                        resolve(pendingOptions)
                        if (closeServer) closeServer()
                        modal.close()
                      } else {
                        resolve(null)
                        modal.close()
                      }
                    }
                  }
                )
              ]
            }
          })

          return {
            step,
            firewallMode,
            firewallModeOptions,
            ipv6Support,
            enableOptions,
            dnsInbound,
            dnsReverseMapping,
            ips,
            urls,
            PORT,
            configRef,
            showCodeModal,
            editedConfig,
            confirmSettings,
            onSettingsCancel,
            copy,
            copyConfigUrl,
            copyConfigJson,
            openCodeModal,
            saveEditedConfig
          }
        },
        template: `
          <div v-if="step === 'settings'" style="
            display: flex; 
            flex-direction: column; 
            max-height: 80vh;
            position: relative;
          ">
            <div style="
              flex: 1; 
              overflow-y: auto; 
              padding: 10px 10px 0 10px; 
              display: flex; 
              flex-direction: column; 
              gap: 10px;
            ">
              <Card title="Firewall Mode" style="margin-bottom: 0; padding: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="text-12">Add matching inbounds</div>
                  <div><Radio v-model="firewallMode" :options="firewallModeOptions" /></div>
                </div>
              </Card>
              <Card title="IPv6 support" style="margin-bottom: 0; padding: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="text-12">Set dns strategy for all</div>
                  <div><Radio v-model="ipv6Support" :options="enableOptions" /></div>
                </div>
              </Card>
              <Card title="DNS redirect" style="margin-bottom: 0; padding: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="text-12">Add <code>dns-in</code> inbound</div>
                  <div><Radio v-model="dnsInbound.enable" :options="enableOptions" /></div>
                </div>
                <div v-if="dnsInbound.enable" style="display: flex; justify-content: space-between; align-items: center;">
                  <div><h5>Port</h5></div>
                  <div><Input v-model="dnsInbound.port" type="number" :min="1" :max="65535" /></div>
                </div>
              </Card>
              <Card title="DNS reverse mapping" style="margin-bottom: 20px; padding: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <div class="text-12">Add <code>dns.reverse_mapping</code> true</div>
                  <div><Radio v-model="dnsReverseMapping" :options="enableOptions" /></div>
                </div>
              </Card>
              <div style="padding-bottom: 10px;"></div>
            </div>
            <div style="
              flex-shrink: 0; 
              display: flex; 
              gap: 12px; 
              justify-content: flex-end; 
              padding: 12px 16px;
              background: inherit;
            ">
              <Button type="text" @click="onSettingsCancel">Cancel</Button>
              <Button type="primary" icon="play" @click="confirmSettings">Create</Button>
            </div>
          </div>
          <div v-else style="padding: 5px; display: flex; flex-direction: column; gap: 10px;">
            <Card title="Entware SSH Command" style="margin-bottom: 0; padding: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                  <div>
                    <pre><code class="select-text font-bold">skeen sync {{ ips[0] ? 'http://' + ips[0] + ':' + PORT : 'URL' }}</code></pre>
                  </div>
                </div>
                <div style="margin-left: 16px;">
                  <Button type="primary" icon="copy" @click="copy('skeen sync ' + (ips[0] ? 'http://' + ips[0] + ':' + PORT : 'URL'))">Copy</Button>
                </div>
              </div>
            </Card>
            <Card title="Web CLI Command" style="margin-bottom: 0; padding: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                  <div>
                    <pre><code class="select-text font-bold">exec skeen sync {{ ips[0] ? 'http://' + ips[0] + ':' + PORT : 'URL' }}</code></pre>
                  </div>
                </div>
                <div style="margin-left: 16px;">
                  <Button type="primary" icon="copy" @click="copy('exec skeen sync ' + (ips[0] ? 'http://' + ips[0] + ':' + PORT : 'URL'))">Copy</Button>
                </div>
              </div>
            </Card>
            <Card style="margin-bottom: 20px; padding: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div><h5>Configuration</h5></div>
                <div style="display: flex; gap: 8px;">
                  <Button type="primary" icon="copy" size="small" style="background-color: #445d6d;" @click="copyConfigUrl">Copy URL</Button>
                  <Button type="primary" icon="copy" size="small" style="background-color: #445d6d;" @click="copyConfigJson">Copy JSON</Button>
                  <Button type="primary" icon="edit" size="small" @click="openCodeModal">Edit</Button>
                </div>
              </div>
            </Card>
          </div>
          <div
            v-if="showCodeModal" 
            style="
              background: var(--modal-bg); 
              box-shadow: 0 -5px 20px rgba(0, 0, 0, 0.05); 
              position: fixed; top: 50%; left: 50%; 
              transform: translate(-50%, -50%); 
              z-index: 9999;" 
              @click.self="showCodeModal = false
            "
          >
            <div style="width: 800px; max-width: 90vw; max-height: 80vh; display: flex; flex-direction: column;">
              <div style="padding: 16px; display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0;">Edit configuration</h3>
                <Button type="text" icon="close" @click="showCodeModal = false" />
              </div>
              <div style="flex: 1; overflow: auto; padding: 20px;">
                <div style="width: 800px; min-width: 800px;">
                  <CodeEditor v-model="editedConfig" lang="json" :editable="true" />
                </div>
              </div>
              <div style="padding: 16px; display: flex; justify-content: flex-end; gap: 8px;">
                <Button type="text" @click="showCodeModal = false">Cancel</Button>
                <Button type="primary" @click="saveEditedConfig">Save</Button>
              </div>
            </div>
          </div>
        `
      })

      let modal
      try {
        modal = Plugins.modal({
          title: 'SKeen Sync',
          minWidth: '50',
          width: '70',
          submit: false,
          footer: false,
          maskClosable: false,
          toolbar: () => ({
            maximize: false,
            minimize: false,
          }),
          afterClose: () => {
            modal.destroy()
          }
        })
        modal.setContent(combinedModal)
        modal.open()
      } catch (e) {
        Plugins.message.error('Failed to open modal: ' + (e.message || String(e)))
        resolve(null)
      }
    })
  }

  return {
    onRun,
    ExportAsURI: null,
    ExportAsSingBox: null,
    ExportAsClash: null
  }
}
