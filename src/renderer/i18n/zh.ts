// Chinese locale strings
const zh: Record<string, string> = {
  // Titlebar
  'app.name': 'Ai-analyzer',
  'view.browser': '浏览器',
  'view.inspector': '检查器',
  'view.report': 'AI报告',
  'view.toolbox': '工具箱',

  // Sessions
  'session.list': '会话列表',
  'session.new': '新建会话',
  'session.delete': '删除会话',

  // Capture
  'capture.start': '开始抓包',
  'capture.stop': '停止抓包',
  'capture.pause': '暂停',
  'capture.resume': '继续',
  'capture.idle': '空闲',
  'capture.capturing': '抓包中',
  'capture.paused': '已暂停',
  'capture.stopped': '已停止',

  // Requests
  'request.filter': '过滤',
  'request.domain': '域名',
  'request.method': '方法',
  'request.status': '状态',
  'request.url': 'URL',
  'request.type': '类型',
  'request.source': '来源',

  // Request detail
  'detail.headers': '请求头',
  'detail.body': '请求体',
  'detail.response': '响应',
  'detail.hooks': 'Hook记录',

  // Analysis
  'analysis.auto': '自动分析',
  'analysis.api': 'API逆向',
  'analysis.security': '安全审计',
  'analysis.performance': '性能分析',
  'analysis.crypto': '加密逆向',
  'analysis.custom': '自定义',
  'analysis.run': '开始分析',
  'analysis.analyzing': '分析中...',
  'analysis.chat': '追问',
  'analysis.python': '生成Python代码',
  'analysis.encryption': '解释加密流程',
  'analysis.securityRisk': '分析安全风险',
  'analysis.apiParams': '列出所有API参数',

  // Settings
  'settings.title': '设置',
  'settings.general': '通用',
  'settings.llm': 'LLM / AI',
  'settings.proxy': '代理 / MITM',
  'settings.mcp': 'MCP',
  'settings.fingerprint': '指纹',
  'settings.interceptor': '拦截器',
  'settings.theme': '主题',
  'settings.locale': '语言',
  'settings.provider': '服务商',
  'settings.model': '模型',
  'settings.apiKey': 'API密钥',
  'settings.baseUrl': '接口地址',
  'settings.maxTokens': '最大Token数',
  'settings.save': '保存',
  'settings.test': '测试连接',
  'settings.proxyPort': '代理端口',
  'settings.systemProxy': '设为系统代理',
  'settings.caInstalled': 'CA证书已安装',
  'settings.installCa': '安装CA',
  'settings.uninstallCa': '卸载CA',

  // Status
  'status.ready': '就绪',
  'status.requests': '请求数',
  'status.hooks': 'Hook数',

  // Toolbox
  'toolbox.aes': 'AES加解密',
  'toolbox.encoding': '编码转换',
  'toolbox.js': 'JS运行器',
  'toolbox.regex': '正则测试',
  'toolbox.timestamp': '时间戳',
  'toolbox.websocket': 'WebSocket',
  'toolbox.qr': '二维码',
  'toolbox.certHash': '证书哈希',
  'toolbox.curl': 'cURL生成',
  'toolbox.fetch': 'Fetch生成',
  'toolbox.har': 'HAR导出',
  'toolbox.formatter': '格式化'
}

export default zh
