import { useState, useEffect } from 'react'
import { RpcConnection, ArchConnection, PubkeyUtil, MessageUtil } from '@saturnbtcio/arch-sdk'
import { getAddress, signMessage } from 'sats-connect'
import { Buffer } from 'buffer'
import { Wheel } from 'react-custom-roulette'
import './App.css'
import { sendTransaction } from './utils/transactionHelpers'
import * as borsh from 'borsh'

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
  const [isAdmin, setIsAdmin] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const [wheelSound] = useState(new Audio('/wheel.mp3'));

  const checkWheelState = async () => {
    if (!sdk) return null
    
    try {
      const wheelAccount = PubkeyUtil.fromHex(import.meta.env.VITE_WHEEL_STATE_ACCOUNT)
      const accountInfo = await sdk.readAccountInfo(wheelAccount)
      if (accountInfo && accountInfo.data) {
        console.log('Raw account data:', Buffer.from(accountInfo.data).toString('hex'))
        
        // Try to deserialize the wheel state
        try {
          const wheelState = borsh.deserialize(
            {
              struct: {
                initialized: 'bool',
                prizes: { array: { type: 'string' } },
                probabilities: { array: { type: 'u8' } },
                // ... other fields can be added as needed
              }
            },
            accountInfo.data
          )
          setIsInitialized(wheelState.initialized)
        } catch (err) {
          console.log('Account exists but not initialized:', err)
          setIsInitialized(false)
        }
        
        return accountInfo.data
      }
      setIsInitialized(false)
      return null
    } catch (err) {
      console.error('Failed to check wheel state:', err)
      setIsInitialized(false)
      return null
    }
  }

  useEffect(() => {
    if (sdk && publicKey) {
      checkWheelState()
    }
  }, [sdk, publicKey])

  const initializeWheel = async () => {
    if (!sdk || !walletAddress || !publicKey) return
    
    try {
      // First, check if the account exists and is initialized
      const wheelAccount = PubkeyUtil.fromHex(import.meta.env.VITE_WHEEL_STATE_ACCOUNT)
      const programId = PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID)

      const accountInfo = await sdk.readAccountInfo(wheelAccount)

      console.log('Initial account info:', accountInfo)
  
      const prizes = wheelData.map(data => data.option)
      const probabilities = [34, 33, 33]
  
      // Log the data we're about to send
      console.log('Initializing with:', {
        prizes,
        probabilities,
        authority: publicKey
      })
  
      const instructionData = Buffer.concat([
        new Uint8Array([0]), // InitializeWheel variant
        borsh.serialize(
          {
            struct: {
              prizes: { array: { type: 'string' } },
              probabilities: { array: { type: 'u8' } }
            }
          },
          {
            prizes,
            probabilities: new Uint8Array(probabilities)
          }
        )
      ])
  
      console.log('Instruction data (hex):', Buffer.from(instructionData).toString('hex'))
  
      const initInstruction = {
        program_id: programId,
        accounts: [
          {
            pubkey: wheelAccount,                    // wheel account first
            is_signer: false,
            is_writable: true
          },
          {
            pubkey: PubkeyUtil.fromHex(publicKey),  // authority second
            is_signer: true,
            is_writable: true
          }
        ],
        data: instructionData
      }

    console.log('Sending transaction with accounts:', {
      signer: publicKey,
      wheel: import.meta.env.VITE_WHEEL_STATE_ACCOUNT,
      program: import.meta.env.VITE_PROGRAM_ID
    })
  
      const txId = await sendTransaction({
        sdk,
        walletAddress,
        publicKey,
        instruction: initInstruction
      })
      console.log('Initialize transaction sent:', txId)
  
      // Wait and check result
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Get processed transaction details
      const processedTx = await sdk.getProcessedTransaction(txId)
      console.log('Processed transaction:', processedTx)
      
      if (processedTx) {
        if (processedTx.status === 'Processed') {
          console.log('Transaction processed successfully')
        } else if (processedTx.status === 'Processing') {
          console.log('Transaction still processing')
        } else if (typeof processedTx.status === 'object' && 'Failed' in processedTx.status) {
          console.error('Transaction failed:', processedTx.status.Failed)
        }
      }

      const finalState = await checkWheelState()
      console.log('Final wheel state:', finalState)
  
    } catch (err) {
      console.error('Failed to initialize wheel:', err)
      throw err
    }
  }

  // Add admin check function
  const checkAdminStatus = async () => {
    if (!sdk || !publicKey) return false
    
    try {
      const wheelAccount = PubkeyUtil.fromHex(import.meta.env.VITE_WHEEL_STATE_ACCOUNT)
      const accountInfo = await sdk.readAccountInfo(wheelAccount)
      if (accountInfo && accountInfo.data) {
        // Deserialize the WheelState to check authority
        const authority = accountInfo.data.slice(1, 33) // First byte is initialized flag, next 32 is authority
        return Buffer.from(authority).toString('hex') === publicKey
      }
      return false
    } catch (err) {
      console.error('Failed to check admin status:', err)
      return false
    }
  }

  useEffect(() => {
    return () => {
      wheelSound.pause();
      wheelSound.currentTime = 0;
    };
  }, [wheelSound]);
  

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
      
      // Check admin status after wallet connection
      const isAdminUser = await checkAdminStatus()
      setIsAdmin(isAdminUser)
    } catch (err) {
      console.error('Failed to connect wallet:', err)
    }
  }

  // Spin wheel function
  const spinWheel = async () => {
    if (!sdk || !walletAddress || !publicKey || wheelState.isSpinning) return
  
    try {
      wheelSound.currentTime = 0; // Reset the audio to start
      wheelSound.loop = true; // Make it loop while spinning
      wheelSound.play().catch(e => console.log('Audio play failed:', e));

      setWheelState(prev => ({ ...prev, isSpinning: true }))
      
      // Generate user secret and commitment
      const userSecret = crypto.getRandomValues(new Uint8Array(32))
      const commitment = await crypto.subtle.digest('SHA-256', userSecret)
      
      // Create commit instruction
      const commitInstruction = {
        program_id: PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID),
        accounts: [
          {
            pubkey: PubkeyUtil.fromHex(publicKey),
            is_signer: true,
            is_writable: false
          },
          {
            pubkey: PubkeyUtil.fromHex(import.meta.env.VITE_WHEEL_STATE_ACCOUNT),
            is_signer: false,
            is_writable: true
          }
        ],
        data: Buffer.concat([
          new Uint8Array([1]), // CommitSpin instruction
          new Uint8Array(commitment)
        ])
      }

      const commitTxId = await sendTransaction({
        sdk,
        walletAddress,
        publicKey,
        instruction: commitInstruction
      })
      console.log('Commit transaction sent:', commitTxId)

      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 2000))

      // Create reveal instruction
      const revealInstruction = {
        program_id: PubkeyUtil.fromHex(import.meta.env.VITE_PROGRAM_ID),
        accounts: [
          {
            pubkey: PubkeyUtil.fromHex(publicKey),
            is_signer: true,
            is_writable: false
          },
          {
            pubkey: PubkeyUtil.fromHex(import.meta.env.VITE_WHEEL_STATE_ACCOUNT),
            is_signer: false,
            is_writable: true
          },
          {
            pubkey: PubkeyUtil.fromHex(import.meta.env.VITE_RECENT_BLOCKHASHES),
            is_signer: false,
            is_writable: false
          },
          {
            pubkey: PubkeyUtil.fromHex(import.meta.env.VITE_SLOT_INFO),
            is_signer: false,
            is_writable: false
          }
        ],
        data: Buffer.concat([
          new Uint8Array([2]), // RevealSpin instruction
          userSecret
        ])
      }

      const revealTxId = await sendTransaction({
        sdk,
        walletAddress,
        publicKey,
        instruction: revealInstruction
      })
      console.log('Reveal transaction sent:', revealTxId)

      // For now, we'll use a random number until we implement getting the result from the chain
      const prizeNumber = Math.floor(Math.random() * wheelData.length)
      setWheelState(prev => ({
        ...prev,
        prizeNumber,
        currentPrize: wheelData[prizeNumber].option
      }))

      setTimeout(() => {
        setWheelState(prev => ({ ...prev, isSpinning: false }));
        wheelSound.pause(); // Stop the sound when wheel stops
        wheelSound.currentTime = 0;
      }, 10000)

    } catch (err) {
      console.error('Failed to spin wheel:', err)
      setWheelState(prev => ({ ...prev, isSpinning: false }))
      wheelSound.pause();
      wheelSound.currentTime = 0;
    }
  }

  

  return (
    <div className="wheel-container">
      <h1>Prize Wheel</h1>
      
      {!walletAddress ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : !isInitialized ? (
        <div>
          <p>Wheel needs to be initialized</p>
          {isAdmin && (
            <button onClick={initializeWheel}>Initialize Wheel</button>
          )}
          {!isAdmin && (
            <p>Please wait for an admin to initialize the wheel.</p>
          )}
        </div>
      ) : (
        <div className="game-container">
          <p>Connected: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</p>
          {isAdmin && <p className="admin-badge">Admin</p>}
          
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