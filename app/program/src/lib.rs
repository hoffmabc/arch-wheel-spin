use arch_program::{
    account::AccountInfo,
    entrypoint,
    msg,
    program::next_account_info,
    program_error::ProgramError,
    pubkey::Pubkey,
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

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct WheelState {
    pub initialized: bool,
    pub prizes: Vec<String>,
    pub probabilities: Vec<u8>,
    pub last_spin_result: Option<usize>,
    pub total_spins: u64,
    pub authority: Pubkey,
    pub last_slot: u64,
    pub last_block_hash: [u8; 32],
    pub user_commitment: [u8; 32],
}

fn get_verifiable_random_value(
    block_hash: &[u8],
    user_secret: &[u8],
    slot: u64,
    probabilities: &[u8]
) -> (usize, [u8; 32]) {
    let mut result = [0u8; 32];
    
    // XOR the block hash with user secret for first 32 bytes
    for i in 0..32 {
        result[i] = block_hash[i] ^ user_secret[i];
    }
    
    // Mix in the slot number
    let slot_bytes = slot.to_le_bytes();
    for i in 0..8 {
        result[i] ^= slot_bytes[i];
    }
    
    // Use first 8 bytes as random number
    let mut random_bytes = [0u8; 8];
    random_bytes.copy_from_slice(&result[0..8]);
    let random_number = u64::from_le_bytes(random_bytes) % 100;
    
    // Select prize using weighted probabilities
    let mut cumulative = 0;
    for (index, &probability) in probabilities.iter().enumerate() {
        cumulative += probability;
        if random_number < cumulative as u64 {
            return (index, result);
        }
    }
    
    (probabilities.len() - 1, result)
}

fn create_commitment(user_secret: &[u8; 32]) -> [u8; 32] {
    let mut commitment = [0u8; 32];
    
    // Simple commitment scheme using XOR with a fixed value
    // In production, you might want a more sophisticated approach
    let fixed_value = [0xAA; 32]; // Example fixed value
    for i in 0..32 {
        commitment[i] = user_secret[i] ^ fixed_value[i];
    }
    
    commitment
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
        WheelInstruction::CommitSpin { commitment } => {
            msg!("Committing Spin");
            process_commit_spin(program_id, accounts, commitment)
        }
        WheelInstruction::RevealSpin { user_secret } => {
            msg!("Revealing Spin");
            process_reveal_spin(program_id, accounts, user_secret)
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

    if probabilities.iter().sum::<u8>() != 100 {
        return Err(ProgramError::InvalidArgument);
    }

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
        last_slot: 0,
        last_block_hash: [0; 32],
        user_commitment: [0; 32],
    };

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
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

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    
    wheel_state.user_commitment = commitment;
    
    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)
}

fn process_reveal_spin(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    user_secret: [u8; 32],
) -> Result<(), ProgramError> {
    let account_info_iter = &mut accounts.iter();
    let wheel_account = next_account_info(account_info_iter)?;
    let player = next_account_info(account_info_iter)?;
    let recent_blockhashes = next_account_info(account_info_iter)?;
    let slot_info = next_account_info(account_info_iter)?;

    if !player.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    let mut wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    
    // Verify the commitment matches
    let commitment = create_commitment(&user_secret);
    if commitment != wheel_state.user_commitment {
        return Err(ProgramError::InvalidArgument);
    }

    // Get current slot
    let slot_data = slot_info.try_borrow_data()?;
    if slot_data.len() < 8 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut slot_bytes = [0u8; 8];
    slot_bytes.copy_from_slice(&slot_data[0..8]);
    let slot = u64::from_le_bytes(slot_bytes);
    
    // Get recent blockhash
    let blockhash_data = recent_blockhashes.try_borrow_data()?;
    if blockhash_data.len() < 32 {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut blockhash = [0u8; 32];
    blockhash.copy_from_slice(&blockhash_data[0..32]);

    let (random_value, final_hash) = get_verifiable_random_value(
        &blockhash,
        &user_secret,
        slot,
        &wheel_state.probabilities
    );

    wheel_state.last_slot = slot;
    wheel_state.last_block_hash = blockhash;
    wheel_state.last_spin_result = Some(random_value);
    wheel_state.total_spins += 1;

    wheel_state.serialize(&mut *wheel_account.try_borrow_mut_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    
    msg!("Wheel spin result: {}", wheel_state.prizes[random_value]);
    msg!("Verification hash: {:?}", final_hash);
    
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

    let wheel_state = WheelState::try_from_slice(&wheel_account.try_borrow_data()?)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    
    if let Some(prize_index) = wheel_state.last_spin_result {
        msg!("Prize claimed: {}", wheel_state.prizes[prize_index]);
        Ok(())
    } else {
        msg!("No prize to claim");
        Err(ProgramError::InvalidAccountData)
    }
}