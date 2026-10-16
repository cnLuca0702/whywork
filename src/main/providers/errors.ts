export function modelError(error:unknown):string{
 const message=error instanceof Error?error.message:String(error)
 if(/abort|取消/i.test(message))return message
 if(/context.{0,20}(length|window)|maximum.{0,10}tokens|上下文.{0,8}(长|限)/i.test(message))return '上下文过长，请减少引用或缩短对话后重试'
 if(/\b(401|403)\b|unauthorized|invalid.{0,6}(key|token)|authentication/i.test(message))return '认证失败，请检查密钥或重新授权'
 if(/\b429\b|\b5\d\d\b|rate.?limit|overload/i.test(message))return '服务商繁忙，与密钥是否有效无关，请稍后重试或切换模型'
 if(/fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network|timeout|网络/i.test(message))return '网络不可达或请求超时，请检查连接和服务地址'
 return message
}
