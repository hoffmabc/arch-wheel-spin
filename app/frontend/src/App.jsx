import { useState, useEffect } from 'react'
import { RpcConnection, ArchConnection, PubkeyUtil, MessageUtil } from '@saturnbtcio/arch-sdk'
import { getAddress, signMessage } from 'sats-connect'
import { Buffer } from 'buffer'
import { Wheel } from 'react-custom-roulette'
import './App.css'

window.Buffer = Buffer

function App() {
  const wheelData = [
    { option: 'Pub #123 ', style: { backgroundColor: '#ff8f43', textColor: 'white' } },
    { option: 'Loser', style: { backgroundColor: '#70bbe0', textColor: 'white' } },
    { option: 'Loser', style: { backgroundColor: '#ff5252', textColor: 'white' } }
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
    const testRpcEndpoint = async () => {
      try {
        const response = await fetch('/api', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'is_node_ready'
          })
        });
        
        const data = await response.json();
        console.log('Test RPC response:', data);
        
        // If test succeeds, initialize SDK
        if (data.result === true) {
          initSDK();
        }
      } catch (err) {
        console.error('RPC test failed:', err);
      }
    };

    const initSDK = async () => {
      const rpcUrl = '/api';
      try {
        const provider = new RpcConnection(rpcUrl);
        const archSdk = ArchConnection(provider);
        setSdk(archSdk);
      } catch (err) {
        console.error('SDK init failed:', err);
      }
    };

    testRpcEndpoint();
  }, []);

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
      
      // Generate user secret and commitment
      const userSecret = crypto.getRandomValues(new Uint8Array(32))
      const commitment = await crypto.subtle.digest('SHA-256', userSecret)
      
      // Create commit instruction data
      const commitInstruction = {
        program_id: PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID),
        accounts: [
          {
            pubkey: PubkeyUtil.fromHex(publicKey),
            is_signer: true,
            is_writable: false
          }
        ],
        data: Buffer.concat([
          new Uint8Array([1]), // CommitSpin instruction
          new Uint8Array(commitment)
        ])
      };
      
      const messageObj = {
        signers: [PubkeyUtil.fromHex(publicKey)],
        instructions: [commitInstruction]
      };
      
      // Hash and sign the complete message
      const messageHash = MessageUtil.hash(messageObj);
      let commitSignature = null;
      await signMessage({
        payload: {
          message: Buffer.from(messageHash).toString('hex'),
          address: walletAddress,
          network: {
            type: 'Testnet'
          }
        },
        onFinish: (response) => {
          if (!response) throw new Error('No signature returned')
          // Take last 64 bytes of signature
          commitSignature = new Uint8Array(Buffer.from(response, 'base64')).slice(2)
        },
        onCancel: () => {
          throw new Error('User cancelled signing')
        }
      });
      
      // Send transaction
      const commitTx = {
        version: 0,
        signatures: [commitSignature],
        message: messageObj
      };
      
      const commitTxId = await sdk.sendTransaction(commitTx);
      console.log('Commit transaction sent:', commitTxId)
  
      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 2000))
  
      // Second transaction: reveal
      let revealSignature = null
      await signMessage({
        payload: {
          message: 'Reveal wheel spin',
          address: walletAddress,
          network: {
            type: 'Testnet'
          }
        },
        onFinish: (response) => {
          if (!response) throw new Error('No signature returned')
          revealSignature = Uint8Array.from(Buffer.from(response, 'base64'))
        },
        onCancel: () => {
          throw new Error('User cancelled signing')
        }
      })
  
      if (!revealSignature) {
        throw new Error('No reveal signature returned from wallet')
      }
  
      // Create reveal instruction
      const revealInstruction = {
        program_id: PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID),
        accounts: [
          {
            pubkey: PubkeyUtil.fromHex(publicKey),
            is_signer: true,
            is_writable: false
          }
        ],
        data: Buffer.concat([
          new Uint8Array([2]), // RevealSpin instruction
          userSecret
        ])
      }
  
      // Send reveal transaction
      const revealTx = {
        version: 0,
        signatures: [revealSignature],
        message: {
          signers: [PubkeyUtil.fromHex(publicKey)],
          instructions: [revealInstruction]
        }
      }
  
      const revealTxId = await sdk.sendTransaction(revealTx)
      console.log('Reveal transaction sent:', revealTxId)
  
      // For now, we'll use a random number until we implement getting the result from the chain
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