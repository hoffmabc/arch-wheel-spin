import { useState, useEffect } from 'react'
import { RpcConnection, ArchConnection, PubkeyUtil } from '@saturnbtcio/arch-sdk'
import { getAddress, signMessage } from 'sats-connect'
import { Buffer } from 'buffer'
import { Wheel } from 'react-custom-roulette'
import './App.css'

window.Buffer = Buffer

function App() {
  const wheelData = [
    { option: 'Prize 1', style: { backgroundColor: '#ff8f43', textColor: 'white' } },
    { option: 'Prize 2', style: { backgroundColor: '#70bbe0', textColor: 'white' } },
    { option: 'Prize 3', style: { backgroundColor: '#ff5252', textColor: 'white' } }
  ]

  const [wheelState, setWheelState] = useState({
    isSpinning: false,
    currentPrize: null,
    prizeNumber: 0
  })
  const [walletAddress, setWalletAddress] = useState(null)
  const [publicKey, setPublicKey] = useState(null)
  const [sdk, setSdk] = useState(null)

  // Initialize Arch SDK with proper provider
  useEffect(() => {
    const initSDK = async () => {
      const rpcUrl = import.meta.env.VITE_RPC_URL || '/api'
      console.log('Connecting to RPC URL:', rpcUrl)
      
      try {
        // Create RPC provider
        const provider = new RpcConnection(rpcUrl)
        
        // Initialize Arch with the provider
        const archSdk = ArchConnection(provider)
        setSdk(archSdk)
        console.log('Successfully connected to RPC')
      } catch (err) {
        console.error('Failed to initialize SDK:', err)
      }
    }
    initSDK()
  }, [])

  // Connect wallet function
  const connectWallet = async () => {
    try {
      await getAddress({
        payload: {
          purposes: ['ordinals'],
          message: 'Connect to Wheel Spin Game',
          network: {
            type: 'Testnet'
          }
        },
        onFinish: (response) => {
          // Store both address and public key
          setWalletAddress(response.addresses[0].address)
          setPublicKey(response.addresses[0].publicKey)
        },
        onCancel: () => {
          console.log('User cancelled wallet connection')
        }
      })
    } catch (err) {
      console.error('Failed to connect wallet:', err)
    }
  }

  // Spin wheel function
  const spinWheel = async () => {
    if (!sdk || !walletAddress || !publicKey || wheelState.isSpinning) return
  
    try {
      setWheelState(prev => ({ ...prev, isSpinning: true }))
      
      // Sign the spin transaction
      const message = 'Spin the wheel!'
      let final_signature = null
      const signature = await signMessage({
        payload: {
          message,
          address: walletAddress,
          network: {
            type: 'Testnet'
          }
        },
        onFinish: (response) => {
          console.log('Signature:', response)
          if (!response) {
            throw new Error('No signature returned')
          }
          // Convert base64 to Uint8Array
          final_signature = Uint8Array.from(Buffer.from(response, 'base64'))
        },
        onCancel: () => {
          throw new Error('User cancelled signing')
        }
      })

      if (!final_signature) {
        throw new Error('No signature returned from wallet')
      }
  
      // Create the instruction
      const instruction = {
        program_id: PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID),
        accounts: [
          {
            pubkey: PubkeyUtil.fromHex(publicKey),
            is_signer: true,
            is_writable: false
          }
        ],
        data: new Uint8Array([1]) // 1 represents SpinWheel instruction
      }
  
      // Create the transaction
      const transaction = {
        version: 0,
        signatures: [final_signature],
        message: {
          signers: [PubkeyUtil.fromHex(publicKey)],
          instructions: [instruction]
        }
      }
  
      console.log('Transaction details:', {
        version: transaction.version,
        signatures: transaction.signatures.map(sig => Buffer.from(sig).toString('hex')),
        message: {
          signers: transaction.message.signers.map(signer => Buffer.from(signer).toString('hex')),
          instructions: transaction.message.instructions.map(inst => ({
            program_id: Buffer.from(inst.program_id).toString('hex'),
            accounts: inst.accounts.map(acc => ({
              pubkey: Buffer.from(acc.pubkey).toString('hex'),
              is_signer: acc.is_signer,
              is_writable: acc.is_writable
            })),
            data: Buffer.from(inst.data).toString('hex')
          }))
        }
      })
  
      // Send the transaction
      const txid = await sdk.sendTransaction(transaction)
      console.log('Transaction sent:', txid)
  
      const prizeNumber = Math.floor(Math.random() * wheelData.length)
      setWheelState(prev => ({
        ...prev,
        prizeNumber,
        currentPrize: wheelData[prizeNumber].option
      }))
  
      // The wheel will automatically stop after the animation
      setTimeout(() => {
        setWheelState(prev => ({ ...prev, isSpinning: false }))
      }, 10000) // Animation takes 10 seconds
  
    } catch (err) {
      console.error('Failed to spin wheel:', err)
      setWheelState(prev => ({ ...prev, isSpinning: false }))
    }
  }

  return (
    <div className="wheel-container">
      <h1>Prize Wheel</h1>
      
      {!walletAddress ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <div className="game-container">
          <p>Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</p>
          
          <div className="wheel-wrapper">
            <Wheel
              mustStartSpinning={wheelState.isSpinning}
              prizeNumber={wheelState.prizeNumber}
              data={wheelData}
              backgroundColors={['#ff8f43', '#70bbe0', '#ff5252']}
              textColors={['white']}
              fontSize={20}
              outerBorderColor={'#eeeeee'}
              outerBorderWidth={3}
              innerRadius={0}
              innerBorderColor={'#30261a'}
              innerBorderWidth={0}
              radiusLineColor={'#eeeeee'}
              radiusLineWidth={1}
              perpendicularText={true}
              textDistance={60}
            />
          </div>

          <button 
            onClick={spinWheel}
            disabled={wheelState.isSpinning}
            className="spin-button"
          >
            {wheelState.isSpinning ? 'Spinning...' : 'Spin Wheel'}
          </button>

          {wheelState.currentPrize && !wheelState.isSpinning && (
            <div className="prize-display">
              <h2>You won: {wheelState.currentPrize}!</h2>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App