const PORT = 52777

const onRun = async () => {
  const store = Plugins.useProfilesStore()
  if (store.profiles.length === 0) {
    throw 'Please create a profile first'
  }
  let profile = null
  if (store.profiles.length === 1) {
    profile = store.profiles[0]
  } else {
    profile = await Plugins.picker.single(
      'Please select profile',
      store.profiles.map((v) => ({
        label: v.name,
        value: v
      })),
      [store.profiles[0]]
    )
  }
  await Share(Plugins.deepClone(profile))
}

const Share = async (profile) => {
  await transformLocalRuleset(profile)

  const options = await openSettingsModal()
  if (!options) return 

  const config = await Plugins.generateConfig(profile, 'stable')

  ensureConfig(config, options)

  const ips = await getIPAddress()
  const urls = await Promise.all(ips.map((ip) => `http://${ip}:${PORT}`))

  const { close } = await Plugins.StartServer('0.0.0.0:' + PORT, Plugin.id, async (req, res) => {
    res.end(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(config, null, 2))
  })

  await openShareModal(ips, urls)
  
  close()
}

function ensureConfig(config, options) {
  ////schema
  config.$schema = "https://gist.githubusercontent.com/artiga033/fea992d95ad44dc8d024b229223b1002/raw/1d0b8a30b74992321acfd303814319eeea6239a3/sing-box.schema.json"
  
  //// inbounds
  if (!config.inbounds) {
    config.inbounds = []
  }
  const existingTags = config.inbounds.map((inbound) => inbound.tag)
  if (['redirect', 'hybrid'].includes(options.skeenMode)){
    if (!existingTags.includes('redirect-in')) {
      config.inbounds.push({
        type: 'redirect',
        tag: 'redirect-in',
        listen: '::',
        listen_port: 65081,
        tcp_fast_open: true
      })
    }
  }
  if(['tproxy', 'hybrid'].includes(options.skeenMode)){
    if (!existingTags.includes('tproxy-in')) {
      config.inbounds.push({
        type: 'tproxy',
        tag: 'tproxy-in',
        listen: '::',
        listen_port: 65082,
        udp_timeout: "3m0s",
        udp_fragment: true,
        ...(options.skeenMode === 'hybrid' ? {network: "udp"} : {tcp_fast_open: true})
      })
    }
  }
  const disableTUNRoutes = tun => {
    tun.auto_route = false
    tun.strict_route = false
  }
  config.inbounds.filter((i) => i.type === 'tun').forEach(disableTUNRoutes)

  //// outbounds
  const allowedNaiveTlsKeys = ['enabled', 'server_name', 'ech']
  config.outbounds
    .filter(o => o.type === 'naive' && o.tls)
    .forEach(o => {
      o.tls = Object.fromEntries(
        Object.entries(o.tls)
          .filter(([key]) => allowedNaiveTlsKeys.includes(key))
      )
    })
  config.outbounds
    .filter(o => o.type === 'vless' && o.tls.reality && !o.tls.utls)
    .forEach(o => {
      o.tls = {
        ...o.tls,
        utls: {
          enabled: true,
          fingerprint: "chrome"
        }
      }
    })   

  //// dns
  if (!config.dns) {
    config.dns = { servers: [], rules: [] }
  }
  if (!config.dns.servers) {
    config.dns.servers = []
  }
  if (!config.dns.rules) {
    config.dns.rules = []
  }
  if (options.ipv6Mode === '0') {
    config.dns.strategy = 'ipv4_only'
    config.dns.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
    config.route.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
  }

  //// route
  if (!config.route) {
    config.route = { rules: [] }
  }
  if (!config.route.rules) {
    config.route.rules = []
  }
  const sniffRuleIndex = config.route.rules.findIndex((rule) => rule.action === 'sniff')
  const newSniffRule = { action: 'sniff' }
  if (sniffRuleIndex === -1) {
    config.route.rules.unshift(newSniffRule)
  }else{
    if(Object.hasOwn(config.route.rules[sniffRuleIndex], 'inbounds')){
      delete config.route.rules[sniffRuleIndex].inbounds
    }
    config.route.rules[sniffRuleIndex] = {...newSniffRule, ...config.route.rules[sniffRuleIndex]}
  }
  const hijackDnsRuleIndex = config.route.rules.findIndex((rule) => rule.action === 'hijack-dns')
  const newHijackDnsRule = {
    type: 'logical',
    mode: 'or',
    rules: [{ port: 53 }, { protocol: 'dns' }],
    action: 'hijack-dns'
  }
  if (hijackDnsRuleIndex !== -1) {
    config.route.rules[hijackDnsRuleIndex] = newHijackDnsRule
  } else {
    const sniffRuleIndex = config.route.rules.findIndex((rule) => rule.action === 'sniff')
    const insertIndex = sniffRuleIndex !== -1 ? sniffRuleIndex + 1 : 0
    config.route.rules.splice(insertIndex, 0, newHijackDnsRule)
  }

  //// experimental
  if (config.experimental?.clash_api) {
    config.experimental.clash_api.external_ui_download_url = 'https://gh-proxy.com/https://github.com/Zephyruso/zashboard/releases/latest/download/dist-no-fonts.zip'
  }
}

async function transformLocalRuleset(profile) {
  const rulesetsStore = Plugins.useRulesetsStore()
  for (const ruleset of profile.route.rule_set) {
    if (ruleset.type === 'local') {
      const _ruleset = rulesetsStore.getRulesetById(ruleset.path)
      if (_ruleset) {
        if (_ruleset.type === 'Http') {
          ruleset.type = 'remote'
          ruleset.url = _ruleset.url
          ruleset.path = ''
        } else if (['File', 'Manual'].includes(_ruleset.type)) {
          if (_ruleset.format === 'source') {
            const _rules = JSON.parse(await Plugins.ReadFile(_ruleset.path)).rules
            ruleset.type = 'inline'
            ruleset.rules = JSON.stringify(_rules)
            ruleset.url = ''
            ruleset.path = ''
          }
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
  const cmd = {
    windows: 'ipconfig',
    linux: 'ip',
    darwin: 'ifconfig'
  }[os]
  const arg = {
    windows: [],
    linux: ['a'],
    darwin: []
  }[os]
  const text = await Plugins.Exec(cmd, arg, { convert: os === 'windows' })
  const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  let ips = text.match(ipv4Pattern) || []
  ips = ips.filter((ip) => isPrivateIP(ip))

  const getPriority = (ip) => {
    if (ip.startsWith('192.')) return 0
    if (ip.startsWith('10.')) return 1
    if (ip.startsWith('172.')) return 2
    return 3
  }
  return [...new Set(ips)].sort((a, b) => getPriority(a) - getPriority(b))
}


async function openSettingsModal() {
  return new Promise((resolve) => {
    const modalComponent = {
      data() {
        return {
          skeenMode: 'tproxy',
          ipv6Mode: '0'
        }
      },
      methods: {
        onConfirm() {
          resolve({ skeenMode: this.skeenMode, ipv6Mode: this.ipv6Mode })
          modal.destroy()
        },
        onCancel() {
          resolve(null) 
          modal.destroy()
        }
      },
      template: `
        <div class="p-4 space-y-4">
          <div class="flex items-center justify-between">
            <h5>Mode</h5>
            <Radio v-model="skeenMode" :options="skeenOptions" />
          </div>
          <div class="flex items-center justify-between">
            <h5>IPv6</h5>
            <Radio v-model="ipv6Mode" :options="ipv6Options" />
          </div>
          <div class="flex justify-end space-x-2" style="margin: 30px auto 10px auto;">
            <Button class="m-2" type="text" @click="onCancel">Cancel</Button>
            <Button class="m-2" type="primary" @click="onConfirm">Create</Button>
          </div>
        </div>
      `,
      computed: {
        skeenOptions() {
          return [
            { label: 'Redirect', value: 'redirect' },
            { label: 'TProxy', value: 'tproxy' },
            { label: 'Hybrid', value: 'hybrid' }
          ]
        },
        ipv6Options() {
          return [
            { label: 'Enabled', value: '1' },
            { label: 'Disable', value: '0' }
          ]
        }
      }
    }

    const modal = Plugins.modal(
      {
        title: 'Settings',
        width: '50',
        footer: false,
        maskClosable: false
      },
      { default: () => Vue.h(modalComponent) }
    )

    modal.open()
  })
}


function openShareModal(ips, urls) {
  return new Promise((resolve) => {
    const cmd1 = `skeen sync ${ips[0] ? `http://${ips[0]}:${PORT}` : 'URL'}`
    const cmd2 = `exec ${cmd1}`

    const component = Vue.defineComponent({
      template: `
        <div class="p-4 space-y-4">
          <!-- Entware SSH command -->
          <div class="flex items-center justify-between">
            <div>
              <h5>Entware SSH command</h5>
              <pre class="bg-gray-50 p-2 rounded">{{ cmd1 }}</pre>
            </div>
            <div>
              <Button type="primary" @click="copy(cmd1)">Copy</Button>
            </div>
          </div>
          <hr>
          <!-- WEB CLI command -->
          <div class="flex items-center justify-between">
            <div>
              <h5>WEB CLI command</h5>
              <pre class="bg-gray-50 p-2 rounded">{{ cmd2 }}</pre>
            </div>
            <div>
              <Button type="primary" @click="copy(cmd2)">Copy</Button>
            </div>
          </div>
          <hr>
          <!-- Share links -->
          <div class="flex items-center justify-between">
            <div>
              <h5>Share links</h5>
              <div v-for="url in urls" :key="url.url">
                <pre class="bg-gray-50 p-2 rounded mb-1">{{ url }}</pre>
              </div>
            </div>
            <div>
              <Button type="primary" @click="copyAll">Copy All</Button>
            </div>
          </div>
        </div>
      `,
      setup() {
        const copy = (text)  => {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
          Plugins.message.success('Copied!')
        }

        const copyAll = () => {
          const allText = [...urls].join('\n')
          copy(allText)
        }

        return { cmd1, cmd2, urls, copy, copyAll }
      }
    })

    const modal = Plugins.modal(
      { 
        title: 'SKeen Sync', 
        width: '50', 
        footer: false, 
        maskClosable: false
      },
      { 
        default: () => Vue.h(component),     
        toolbar: () => [
          Vue.h(Vue.resolveComponent("Button"), {
            type: "text",
            icon: "close",
            onClick: () => {resolve(); modal.destroy()}
          })
        ]
      }
    )
    modal.open()
  })
}
