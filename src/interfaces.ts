export interface NodeChain {
  id: string
  url: string
}

export interface GatewayNode {
  id: string
  chains: NodeChain[]
}

export interface RpcEndpoint {
  id: string
  gateway: string
  chainId: string
  protocol: 'http'
  address: string
  port: number
  disabled: boolean
}

export interface Provider {
  id: string
  email: string
  name: string
  keyHash: string
  keySalt: string
  poktAddress: string
  agreeTos: boolean,
  agreeTosDate: string,
  agreePrivacyPolicy: boolean,
  agreePrivacyPolicyDate: string,
}

export interface SessionToken {
  token: string
  user: string
  expiration: string
}

export interface Gateway {
  id: string
  region: string
  provider: string
  address: string
  privateAddress: string
  statsUser: string
  statsPass: string
  httpPort: number
  apiPort: number
  statsPort: number
  controlPort: number
  serverStartingHttpPort: number
  serverStartingApiPort: number
  serverStartingStatsPort: number
  serverStartingControlPort: number
}
