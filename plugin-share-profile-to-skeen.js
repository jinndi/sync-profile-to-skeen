const JS_FILE = 'https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.js'
const PATH = 'data/third/share-profile-to-skeen'
let mode = 'tproxy'

const onRun = async () => {
  const store = Plugins.useProfilesStore()
  if (store.profiles.length === 0) {
    throw 'Please create a configuration first.'
  }
  let profile = null
  if (store.profiles.length === 1) {
    profile = store.profiles[0]
  } else {
    profile = await Plugins.picker.single(
      'Please select the configuration you want to share.',
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
  await loadDependence()

  await transformLocalRuleset(profile)

  mode = await Plugins.picker.single(
    'SKeen mode',
    [
      { label: 'Redirect', value: 'redirect' },
      { label: 'TProxy', value: 'tproxy' },
      { label: 'Hybrid', value: 'hybrid' }
    ],
    ['tproxy']
  )

  const type = await Plugins.picker.single(
    'Sing-box version',
    [
      { label: 'Sing-box v1.11.0-', value: 'legacy' },
      { label: 'Sing-box v1.11.0+', value: 'main' },
      { label: 'Sing-box v1.12.0+', value: 'stable' }
    ],
    ['stable']
  )

  let config = await Plugins.generateConfig(profile, type === 'stable' || type === 'legacy')

  if (type === 'legacy') {
    _adaptToMain(config)
    _adaptToLegacy(config)
  } else if (type === 'main') {
    _adaptToMain(config)
  }

  ensureSKeenInbounds(config)
  replaceClashUIToZashboard(config)

  if (Plugin.Ipv6Mode === 'disabled') {
    config.dns.strategy = 'ipv4_only'
    config.dns.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
    config.route.rules.forEach((rule) => {
      if (rule.strategy) rule.strategy = 'ipv4_only'
    })
  }

  const validation = validateRequiredTags(config)
  if (!validation.success) {
    Plugins.alert('Configuration verification failed.', validation.missing.join('\n'))
    return
  }

  const ips = await getIPAddress()
  const urls = await Promise.all(
    ips.map((ip) => {
      const url = `http://${ip}:${Plugin.Port}`
      return getQRCode(url, url)
    })
  )

  const { close } = await Plugins.StartServer('0.0.0.0:' + Plugin.Port, Plugin.id, async (req, res) => {
    res.end(200, { 'Content-Type': 'application/json; charset=utf-8' }, JSON.stringify(config, null, 2))
  })

  await Plugins.alert(
    Plugin.name,
    '### SKeen Configuration Sharing\n\n' +
      '在 Download for SSH using command：\n\n' +
      '```bash\n' +
      `curl -o /opt/etc/skeen/config.json ${ips[0] ? `http://${ips[0]}:${Plugin.Port}` : 'URL'}\n` +
      '```\n\n' +
      '|Share link | QR code|\n|-|-|\n' +
      urls.map((url) => `|${url.url}|![](${url.qrcode})|`).join('\n'),
    { type: 'markdown' }
  )
  close()
}

const onInstall = async () => {
  await Plugins.Download(JS_FILE, PATH + '/qrcode.min.js')
  await Plugins.message.success('Installation successful')
  return 0
}

const onUninstall = async () => {
  await Plugins.RemoveFile(PATH)
  return 0
}

function validateRequiredTags(config) {
  const requiredInboundTags = []
  switch(mode){
    case 'redirect':
      requiredInboundTags.push('redirect-in')
      break
    case 'tproxy':
      requiredInboundTags.push('tproxy-in')
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

function ensureSKeenInbounds(config) {
  if (!config.inbounds) {
    config.inbounds = []
  }

  const filterInbound = (type) => config.inbounds.filter((i) => i.type === type)
  const existingTags = config.inbounds.map((inbound) => inbound.tag)

  if (['redirect', 'hybrid'].includes(mode)){
    if (!existingTags.includes('redirect-in')) {
      config.inbounds.push({
        type: 'redirect',
        tag: 'redirect-in',
        listen: '::',
        listen_port: 2081
      })
    }
  }

  if(['tproxy', 'hybrid'].includes(mode)){
    if (!existingTags.includes('tproxy-in')) {
      config.inbounds.push({
        type: 'tproxy',
        tag: 'tproxy-in',
        listen: '::',
        listen_port: 2082,
        udp_timeout: "3m0s",
        udp_fragment: true,
        ...(mode === 'hybrid' ? {network: "udp"} : {tcp_fast_open: true})
      })
    }
  }

  filterInbound('tun').forEach(tun => {
    if (tun ) {
      if (tun.auto_route !== false) {
        tun.auto_route = false
      }
      if (tun.strict_route !== false) {
        tun.strict_route = false
      }
    }
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

  const hasSniffRule = config.route.rules.some((rule) => rule.action === 'sniff')

  if (!hasSniffRule) {
    const sniffRuleIndex = config.route.rules.findIndex((rule) => rule.action === 'sniff')
    if (sniffRuleIndex === -1) {
      config.route.rules.unshift({
        action: 'sniff'
      })
    }
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

const _adaptToMain = (config) => {
  const DnsServer = {
    Local: 'local',
    Hosts: 'hosts',
    Tcp: 'tcp',
    Udp: 'udp',
    Tls: 'tls',
    Https: 'https',
    Quic: 'quic',
    H3: 'h3',
    Dhcp: 'dhcp',
    FakeIP: 'fakeip'
  }

  const generateDnsServerURL = (dnsServer) => {
    const { type, server_port, path, server, interface: _interface } = dnsServer
    let address = ''
    if (type == DnsServer.Https) {
      address = `https://${server}${server_port ? ':' + server_port : ''}${path ? path : ''}`
    } else if (type == DnsServer.H3) {
      address = `h3://${server}${server_port ? ':' + server_port : ''}${path ? path : ''}`
    } else if (type == DnsServer.Dhcp) {
      address = `dhcp://${_interface}`
    } else if (type == DnsServer.FakeIP) {
      address =
        'fake-ip://' +
        (dnsServer.inet4_range ? dnsServer.inet4_range : '') +
        (dnsServer.inet6_range ? (dnsServer.inet4_range ? ',' : '') + dnsServer.inet6_range : '')
    } else if (type === DnsServer.Hosts) {
      address = 'hosts'
    } else if (type === DnsServer.Local) {
      address = 'local'
    } else {
      address = `${type}://${server}${server_port ? ':' + server_port : ''}`
    }
    return address
  }

  config.dns.rules.unshift({
    action: 'route',
    server: config.route.default_domain_resolver.server,
    outbound: 'any'
  })
  delete config.route.default_domain_resolver
  config.dns.servers = config.dns.servers.map((server) => {
    const isFakeIP = server.type === DnsServer.FakeIP
    if (isFakeIP) {
      config.dns.fakeip = {
        enabled: true,
        inet4_range: server.inet4_range,
        inet6_range: server.inet6_range
      }
    }
    let detour = server.detour
    if (!detour) {
      const isSupportDetour = [
        DnsServer.Local,
        DnsServer.Tcp,
        DnsServer.Udp,
        DnsServer.Tls,
        DnsServer.Quic,
        DnsServer.Https,
        DnsServer.H3,
        DnsServer.Dhcp
      ].includes(server.type)
      isSupportDetour && (detour = config.outbounds.find((v) => v.type === 'direct')?.tag)
    }
    return {
      tag: server.tag,
      address: isFakeIP ? 'fakeip' : generateDnsServerURL(server),
      address_resolver: server.domain_resolver,
      detour: detour
    }
  })
  config.dns.rules = config.dns.rules.filter((rule) => rule.ip_accept_any === undefined)
  config.dns.rules.forEach((rule) => {
    delete rule.strategy
  })
}

const _adaptToLegacy = (config) => {
  const isExists = (id) => config.outbounds.find((v) => v.type === id && v.tag === id)

  if (!isExists('direct')) {
    config.outbounds.push({
      type: 'direct',
      tag: 'direct'
    })
  }

  if (!isExists('block')) {
    config.outbounds.push({
      type: 'block',
      tag: 'block'
    })
  }

  config.outbounds.push({
    type: 'dns',
    tag: 'dns-out'
  })

  config.route.rules = config.route.rules.flatMap((rule) => {
    if (rule.action === 'sniff') {
      if (rule.inbound) {
        const inbound = config.inbounds.find((v) => v.tag === rule.inbound)
        if (inbound) {
          inbound.sniff = true
        }
      }
      return []
    } else if (rule.action === 'resolve') {
      if (rule.inbound) {
        const inbound = config.inbounds.find((v) => v.tag === rule.inbound)
        if (inbound) {
          inbound.domain_strategy = rule.strategy
        }
      }
      return []
    } else if (rule.action === 'reject') {
      rule.outbound = 'block'
    } else if (rule.action === 'hijack-dns') {
      rule.outbound = 'dns-out'
    }
    rule.action = undefined
    return rule
  })

  config.dns.rules.forEach((rule) => {
    if (rule.action === 'reject') {
      rule.outbound = 'block'
    }
    rule.action = undefined
  })
}

function loadDependence() {
  return new Promise(async (resolve, reject) => {
    if (window.QRCode) {
      resolve()
      return
    }
    try {
      const text = await Plugins.ReadFile(PATH + '/qrcode.min.js')
      const script = document.createElement('script')
      script.id = Plugin.id
      script.text = text
      document.body.appendChild(script)
      resolve()
    } catch (error) {
      console.error(error)
      reject('QR code generation dependency installation failed. Please reinstall this plugin.')
    }
  })
}

function getQRCode(rawUrl, rawStr) {
  return new Promise((resolve) => {
    QRCode.toDataURL(rawStr, async (err, url) => {
      resolve({ url: rawUrl, qrcode: url })
    })
  })
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
