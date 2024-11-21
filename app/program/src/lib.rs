use arch_program::{
    account::AccountInfo,
    entrypoint,
    instruction::Instruction,
    msg,
    program::next_account_info,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use borsh::{BorshDeserialize, BorshSerialize};
use arch_program::utxo::UtxoMeta;

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub enum WheelInstruction {
    // Initialize the wheel with prizes
    InitializeWheel {
        prizes: Vec<String>,
        probabilities: Vec<u8>, // Probabilities for each prize (must sum to 100)
    },
    // Spin the wheel
    SpinWheel,
    // Claim a prize
    ClaimPrize,
}

// Structure to store wheel state
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WheelState {
    pub initialized: bool,
    pub prizes: Vec<String>,
    pub probabilities: Vec<u8>,
    pub last_spin_result: Option<usize>, // Index of the last prize won
    pub total_spins: u64,
    pub authority: Pubkey,
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
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?).map_err(map_to_program_error)?;
    
    if !wheel_state.initialized {
        return Err(ProgramError::UninitializedAccount);
    }

    // Generate random result based on probabilities
    let random_value = get_random_value(&wheel_state.probabilities);
    wheel_state.last_spin_result = Some(random_value);
    wheel_state.total_spins += 1;

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?).map_err(map_to_program_error)?;
    
    msg!("Wheel spin result: {}", wheel_state.prizes[random_value]);
    Ok(())
}

// Helper function to get random value based on probabilities
fn get_random_value(probabilities: &[u8]) -> usize {
    // In a real implementation, you would want to use a more secure source of randomness
    // This is just a simple example
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    
    let random_number = timestamp % 100;
    let mut cumulative = 0;
    
    for (index, &probability) in probabilities.iter().enumerate() {
        cumulative += probability;
        if random_number < cumulative as u64 {
            return index;
        }
    }
    
    probabilities.len() - 1
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