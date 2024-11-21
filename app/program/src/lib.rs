use arch_program::{
    account::AccountInfo,
    entrypoint,
    instruction::Instruction,
    msg,
    program::next_account_info,
    program_error::ProgramError,
    pubkey::Pubkey,
    hash::{hash, Hash},
};
use borsh::{BorshDeserialize, BorshSerialize};


#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum WheelInstruction {
    InitializeWheel {
        prizes: Vec<String>,
        probabilities: Vec<u8>,
    },
    CommitSpin {
        commitment: [u8; 32], // Hash of user's secret value
    },
    RevealSpin {
        user_secret: [u8; 32], // Original secret value
    },
    ClaimPrize,
}

// Structure to store wheel state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WheelState {
    pub initialized: bool,
    pub prizes: Vec<String>,
    pub probabilities: Vec<u8>,
    pub last_spin_result: Option<usize>,
    pub total_spins: u64,
    pub authority: Pubkey,
    // Store verification data
    pub last_slot: u64,
    pub last_block_hash: [u8; 32],
    pub user_commitment: [u8; 32],
}

entrypoint!(process_instruction);

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> Result<(), ProgramError> {
    let instruction = WheelInstruction::try_from_slice(instruction_data)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    match instruction {
        WheelInstruction::InitializeWheel { prizes, probabilities } => {
            msg!("Initializing Wheel");
            process_initialize(program_id, accounts, prizes, probabilities)
        }
        WheelInstruction::SpinWheel => {
            msg!("Spinning Wheel");
            process_spin(program_id, accounts)
        }
        WheelInstruction::ClaimPrize => {
            msg!("Claiming Prize");
            process_claim_prize(program_id, accounts)
        }
    }
}

fn process_initialize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    prizes: Vec<String>,
    probabilities: Vec<u8>,
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let authority = next_account_info(account_info_iter)?;

    if !authority.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Validate probabilities sum to 100
    if probabilities.iter().sum::<u8>() != 100 {
        return Err(ProgramError::InvalidArgument);
    }

    // Validate prizes and probabilities have same length
    if prizes.len() != probabilities.len() {
        return Err(ProgramError::InvalidArgument);
    }

    let wheel_state = WheelState {
        initialized: true,
        prizes,
        probabilities,
        last_spin_result: None,
        total_spins: 0,
        authority: *authority.key,
    };

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?).map_err(map_to_program_error)?;
    Ok(())
}

fn map_to_program_error(error: std::io::Error) -> ProgramError {
    msg!("Serialization error: {}", error);
    ProgramError::InvalidAccountData
}

fn process_spin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    user_entropy: [u8; 32],
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;
    let recent_blockhash_account = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)?;
    
    if !wheel_state.initialized {
        return Err(ProgramError::UninitializedAccount);
    }

    // Get current block hash
    let current_blockhash: [u8; 32] = recent_blockhash_account
        .try_borrow_data()?
        .try_into()
        .map_err(|_| ProgramError::InvalidAccountData)?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let (random_value, final_hash) = get_verifiable_random_value(
        &current_blockhash,
        &user_entropy,
        timestamp,
        &wheel_state.probabilities
    );

    // Store all randomness components for verification
    wheel_state.last_block_hash = current_blockhash;
    wheel_state.user_entropy = user_entropy;
    wheel_state.spin_timestamp = timestamp;
    wheel_state.last_spin_result = Some(random_value);
    wheel_state.total_spins += 1;

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)?;
    
    msg!("Wheel spin result: {}", wheel_state.prizes[random_value]);
    msg!("Verification hash: {}", hex::encode(final_hash));
    
    Ok(())
}

fn get_verifiable_random_value(
    slot: u64,
    block_hash: &[u8; 32],
    user_secret: &[u8; 32],
    probabilities: &[u8]
) -> (usize, [u8; 32]) {
    // Combine inputs deterministically
    let mut combined = [0u8; 32 + 32 + 8];
    combined[0..32].copy_from_slice(block_hash);
    combined[32..64].copy_from_slice(user_secret);
    combined[64..].copy_from_slice(&slot.to_le_bytes());
    
    // Hash the combined value
    let hash_result = hash(&combined).to_bytes();
    
    // Use first 8 bytes for the random number
    let random_bytes: [u8; 8] = hash_result[0..8].try_into().unwrap();
    let random_number = u64::from_le_bytes(random_bytes) % 100;
    
    // Select prize using weighted probabilities
    let mut cumulative = 0;
    for (index, &probability) in probabilities.iter().enumerate() {
        cumulative += probability;
        if random_number < cumulative as u64 {
            return (index, hash_result);
        }
    }
    
    (probabilities.len() - 1, hash_result)
}

fn process_reveal_spin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    user_secret: [u8; 32],
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;
    let slot_history = next_account_info(account_info_iter)?;
    let recent_blockhashes = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)?;
    
    // Verify the commitment matches
    let commitment = hash(&user_secret).to_bytes();
    if commitment != wheel_state.user_commitment {
        return Err(ProgramError::InvalidArgument);
    }

    // Get current slot and blockhash
    let slot = arch_program::clock::Clock::get()?.slot;
    let blockhash = recent_blockhashes.try_borrow_data()?[0..32].try_into().unwrap();

    let (random_value, final_hash) = get_verifiable_random_value(
        slot,
        &blockhash,
        &user_secret,
        &wheel_state.probabilities
    );

    // Store verification data
    wheel_state.last_slot = slot;
    wheel_state.last_block_hash = blockhash;
    wheel_state.last_spin_result = Some(random_value);
    wheel_state.total_spins += 1;

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)?;
    
    msg!("Wheel spin result: {}", wheel_state.prizes[random_value]);
    msg!("Verification hash: {:?}", final_hash);
    
    Ok(())
}

fn process_commit_spin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    commitment: [u8; 32],
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)?;
    wheel_state.user_commitment = commitment;
    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)?;
    
    Ok(())
}

fn process_claim_prize(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?).map_err(map_to_program_error)?;
    
    if let Some(prize_index) = wheel_state.last_spin_result {
        msg!("Prize claimed: {}", wheel_state.prizes[prize_index]);
        Ok(())
    } else {
        msg!("No prize to claim");
        Err(ProgramError::InvalidAccountData)
    }
}

// #[cfg(test)]
// mod tests {
//     use super::*;
//     use arch_program::{
//         account::AccountInfo,
//         pubkey::Pubkey,
//         utxo::UtxoMeta,
//     };
//     use std::cell::RefCell;
//     use std::rc::Rc;

//     fn create_test_account(
//         key: Pubkey,
//         owner: Pubkey,
//         size: usize,
//         is_signer: bool,
//     ) -> AccountInfo {
//         let data = RefCell::new(vec![0; size]);
//         let utxo = UtxoMeta::from([0; 32], 0);
        
//         AccountInfo::new(
//             &key,
//             &data,
//             &owner,
//             &utxo,
//             is_signer,
//             true,  // is_writable
//             false, // is_executable
//         )
//     }

//     #[test]
//     fn test_initialize_wheel() {
//         let program_id = Pubkey::new_unique();
//         let wheel_key = Pubkey::new_unique();
//         let authority_key = Pubkey::new_unique();

//         // Create accounts with RefCell for proper data management
//         let wheel_account = create_test_account(wheel_key, program_id, 1024, false);
//         let authority_account = create_test_account(authority_key, program_id, 0, true);

//         let prizes = vec!["Prize1".to_string(), "Prize2".to_string()];
//         let probabilities = vec![50, 50];

//         let accounts = vec![wheel_account.clone(), authority_account];

//         let result = process_initialize(&program_id, &accounts, prizes.clone(), probabilities.clone());
//         assert!(result.is_ok());

//         // Verify state
//         let wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data().unwrap())
//             .map_err(map_to_program_error)
//             .unwrap();
        
//         assert!(wheel_state.initialized);
//         assert_eq!(wheel_state.prizes, prizes);
//         assert_eq!(wheel_state.probabilities, probabilities);
//         assert_eq!(wheel_state.total_spins, 0);
//     }
// }