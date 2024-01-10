// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.11;

interface ITreasury {

    event SupportedTokenAdded(address tokenAddress);
    event SupportedTokenRemoved(address tokenAddress);
    event AddedOpenFund(address vaultAddress);
    event CollectedOpenFunds();
    event DistributedNativeTokensToLockedFund(address indexed vaultAddress, uint amount);
    event DistributedNativeTokensToLockedFunds(uint balanceBeforeDistribution, uint numberOfRecipients);
    event DistributedSupportedTokenToLockedFund(address indexed supportedToken, address indexed vaultAddress, uint amount);
    event DistributedSupportedTokensToLockedFunds(address indexed supportedToken, uint balanceBeforeDistribution, uint numberOfRecipients);
    event OriginProtocolTokenUpdated(address oldAddress, address newAddress);
    event Received(address _from, uint _amount);

    /**
     * @notice returns array of supported tokens
     */
    function supportedTokens() external view returns (address[] memory);

    /**
     * @notice Add an open vault address to the treasury
     * @param vaultAddress The address of the open vault
     */
    function addOpenFund(address vaultAddress) external;
    
	/**
     *  @notice Iterates through all the open vaults and calls the sendToTreasury() method on them
     */
	function collect() external;

	/**
     *  @notice Distributes treasury ETH balance to all locked vaults
     */
	function distributeNativeTokenRewards() external;

    /**
     *  @notice Distributes supported token balances to locked vaults with balance
     */
    function distributeSupportedTokenRewards(address supportedTokenAddress) external;

    function oETHTokenAddress() external returns(address payable);
}