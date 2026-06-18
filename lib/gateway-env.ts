import "server-only"

export function getGatewayApiKey() {
  return process.env.AI_GATEWAY_API_KEY
}

export function ensureGatewayApiKey() {
  const apiKey = getGatewayApiKey()

  if (!apiKey) {
    throw new Error("Missing AI Gateway API key. Set AI_GATEWAY_API_KEY.")
  }

  return apiKey
}
