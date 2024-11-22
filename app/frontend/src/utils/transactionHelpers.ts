import { RpcConnection, PubkeyUtil, MessageUtil } from '@saturnbtcio/arch-sdk'
import { BitcoinNetworkType, signMessage } from 'sats-connect'
import { Buffer } from 'buffer'

export type Account = {
  pubkey: Uint8Array
  is_signer: boolean
  is_writable: boolean
}

export type Instruction = {
  program_id: Uint8Array
  accounts: Account[]
  data: Uint8Array
}

export async function sendTransaction({
  sdk,
  walletAddress,
  publicKey,
  instruction
}: {
  sdk: RpcConnection
  walletAddress: string
  publicKey: string
  instruction: Instruction
}) {
  const messageObj = {
    signers: [PubkeyUtil.fromHex(publicKey)],
    instructions: [instruction]
  }

  // Hash and sign the complete message
  const messageHash = MessageUtil.hash(messageObj)
  let signature: Uint8Array | null = null

  await signMessage({
    payload: {
      message: Buffer.from(messageHash).toString('hex'),
      address: walletAddress,
      network: {
        type: BitcoinNetworkType.Testnet
      }
    },
    onFinish: (response) => {
      if (!response) throw new Error('No signature returned')
      // Take last 64 bytes of signature
      signature = new Uint8Array(Buffer.from(response, 'base64')).slice(2)
    },
    onCancel: () => {
      throw new Error('User cancelled signing')
    }
  })

  if (!signature) {
    throw new Error('No signature returned from wallet')
  }

  const tx = {
    version: 0,
    signatures: [signature],
    message: messageObj
  }

  return await sdk.sendTransaction(tx)
}