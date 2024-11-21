# Wheel Spin Program

A Solana-style blockchain program that implements a prize wheel spinning game with configurable prizes and probabilities.

## Overview

This program allows users to:
- Initialize a wheel with custom prizes and their probabilities
- Spin the wheel to win prizes
- Claim won prizes

## Program Structure

The program consists of three main instructions:
1. `InitializeWheel` - Sets up the wheel with prizes and probabilities
2. `SpinWheel` - Spins the wheel to get a random prize
3. `ClaimPrize` - Claims a previously won prize

## State Management

The program maintains state through the `WheelState` struct which tracks:
- Initialization status
- Available prizes
- Prize probabilities
- Last spin result
- Total number of spins
- Authority (admin) public key

## Usage

### 1. Initialize the Wheel

// Example initialization with 3 prizes
let prizes = vec!["Prize1", "Prize2", "Prize3"];
let probabilities = vec![50, 30, 20]; // Must sum to 100

### 2. Spin the Wheel

// Any user can spin the wheel
// Requires a signed transaction

### 3. Claim Prize

// Must be called after a successful spin
// Requires the winner's signature

## Important Notes

1. Prize probabilities must:
   - Be provided as u8 values
   - Sum to exactly 100
   - Match the number of prizes

2. Security Considerations:
   - The current random number generation is simplified for demonstration
   - Production deployments should use a more secure randomness source
   - Only the authority can initialize the wheel
   - Only signed transactions are accepted for spins and claims

## Development

### Prerequisites
- Rust toolchain
- Solana development environment
- Borsh serialization library

### Building
cargo build

### Testing
cargo test

## Future Improvements

1. Implement secure randomness generation
2. Add prize inventory management
3. Include cooldown periods between spins
4. Add payment integration
5. Implement player history tracking
6. Add administrative functions for prize management
7. Implement prize distribution mechanics
