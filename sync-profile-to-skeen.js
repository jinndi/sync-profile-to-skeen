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
      'Please select the profile you want to share',
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

  const skeenMode = await Plugins.picker.single(
    'SKeen mode',
    [
      { label: 'Redirect', value: 'redirect' },
      { label: 'TProxy', value: 'tproxy' },
      { label: 'Hybrid', value: 'hybrid' }
    ],
    ['tproxy']
  )

  const ipv6Mode = await Plugins.picker.single(
    'IPv6 settings',
    [
      { label: 'Enabled', value: '1' },
      { label: 'Disable', value: '0' }
    ],
    ['0']
  )

  let config = await Plugins.generateConfig(profile, 'stable')

  ensureSKeenInbounds(config, skeenMode)
  replaceClashUIToZashboard(config)

  if (ipv6Mode === '0') {
    config.dns.strategy = 'ipv4_only'
    config.dns.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
    config.route.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
  }

  const validation = validateRequiredTags(config, skeenMode)
  if (!validation.success) {
    Plugins.alert('Configuration verification failed.', validation.missing.join('\n'))
    return
  }

  const ips = await getIPAddress()
  const urls = await Promise.all(
    ips.map((ip) => {
      return { url: `http://${ip}:${PORT}`}
    })
  )

  const { close } = await Plugins.StartServer('0.0.0.0:' + PORT, Plugin.id, async (req, res) => {
    res.end(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(config, null, 2))
  })

  await Plugins.alert(
    Plugin.name,
    '# SKeen Sync\n\n' +
      '### Entware SSH command\n\n' +
      '```bash\n' +
      `curl -o /opt/etc/skeen/config.json ${ips[0] ? `http://${ips[0]}:${PORT}` : 'URL'}\n` +
      '```\n\n' +
      '### Share links\n\n' +
      urls.map((url) => `- ${url.url}`).join('\n'),
    { type: 'markdown' }
  )
  close()
}


function validateRequiredTags(config, skeenMode) {
  const requiredInboundTags = []
  switch(skeenMode){
    case 'redirect':
      requiredInboundTags.push('redirect-in')
      break
    case 'tproxy':
      requiredInboundTags.push('tproxy-in')
      break
    default:
      requiredInboundTags.push('redirect-in', 'tproxy-in')
  }

  const missing = []

  const inboundTags = (config.inbounds || []).map((i) => i.tag)
  for (const tag of requiredInboundTags) {
    if (!inboundTags.includes(tag)) {
      missing.push(`inbound: ${tag}`)
    }
  }

  return { success: missing.length === 0, missing }
}

function replaceClashUIToZashboard(config) {
  if (config.experimental?.clash_api) {
    config.experimental.clash_api.external_ui_download_url = 'https://gh-proxy.com/https://github.com/Zephyruso/zashboard/releases/latest/download/dist-no-fonts.zip'
  }
}

function ensureSKeenInbounds(config, skeenMode) {
  if (!config.inbounds) {
    config.inbounds = []
  }

  const existingTags = config.inbounds.map((inbound) => inbound.tag)

  if (['redirect', 'hybrid'].includes(skeenMode)){
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

  if(['tproxy', 'hybrid'].includes(skeenMode)){
    if (!existingTags.includes('tproxy-in')) {
      config.inbounds.push({
        type: 'tproxy',
        tag: 'tproxy-in',
        listen: '::',
        listen_port: 65082,
        udp_timeout: "3m0s",
        udp_fragment: true,
        ...(skeenMode === 'hybrid' ? {network: "udp"} : {tcp_fast_open: true})
      })
    }
  }

  const disableTUNRoutes = tun => {
    tun.auto_route = false
    tun.strict_route = false
  }
  config.inbounds.filter((i) => i.type === 'tun').forEach(disableTUNRoutes)


  const allowedNaiveTlsKeys = ['enabled', 'server_name', 'ech']
  config.outbounds
    .filter(o => o.type === 'naive' && o.tls)
    .forEach(o => {
      o.tls = Object.fromEntries(
        Object.entries(o.tls)
          .filter(([key]) => allowedNaiveTlsKeys.includes(key))
      )
    })

  if (!config.dns) {
    config.dns = { servers: [], rules: [] }
  }
  if (!config.dns.servers) {
    config.dns.servers = []
  }

  if (!config.dns.rules) {
    config.dns.rules = []
  }

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
