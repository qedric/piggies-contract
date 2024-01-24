// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IGenerator.sol";
import "./IVault.sol";

interface IExtendedERC20 is IERC20 {
    function name() external view returns (string memory);
    function symbol() external view returns (string memory);
}

contract Generator is IGenerator, AccessControl {

    string internal _chainSymbol;
    using SafeERC20 for IERC20;

    constructor(string memory chainSymbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _chainSymbol = chainSymbol;
    }

    function uri(string memory tokenUrl, uint256 tokenId, address vaultAddress) external view returns (string memory) {
        
        IVault.Attr memory attributes = IVault(vaultAddress).attributes();
        string memory baseAttributes = _generateBaseAttributes(attributes, vaultAddress, _calculatePercent(attributes, _getBalance(attributes, vaultAddress)), _getBalance(attributes, vaultAddress));

        return string(
            abi.encodePacked(
                "data:application/json;base64,",
                Base64.encode(bytes(_generateJson(tokenUrl, tokenId, attributes, baseAttributes, vaultAddress)))
            )
        );
    }

    function _generateJson(
        string memory tokenUrl,
        uint256 tokenId,
        IVault.Attr memory attributes,
        string memory baseAttributes,
        address vaultAddress
    ) internal view returns (string memory) {
        return string(abi.encodePacked(
            '{"name":"', attributes.name,
            '","description":"', attributes.description,
            '","image_data":"', _generateSVG(_calculatePercent(attributes, _getBalance(attributes, vaultAddress))),
            '","external_url":"', tokenUrl,
            _uint2str(tokenId),
            '","', baseAttributes, '}'
        ));
    }

    function _generateBaseAttributes(
        IVault.Attr memory attributes,
        address vaultAddress,
        uint256 percent,
        uint256 balance
    ) internal view returns (string memory) {
        return string(abi.encodePacked(
            'attributes":[{"display_type":"date","trait_type":"Maturity Date","value":',
            _uint2str(attributes.unlockTime),
            '},{"trait_type":"Target Balance","value":"',
            _convertWeiToEthString(attributes.targetBalance),
            ' ',
            _getTokenSymbol(attributes.baseToken),
            '"},{"trait_type":"Current Balance","value":"',
            _convertWeiToEthString(balance),
            ' ',
            _getTokenSymbol(attributes.baseToken),
            '"},{"trait_type":"Receive Address","value":"0x',
            _toAsciiString(vaultAddress),
            '"},{"display_type":"boost_percentage","trait_type":"Percent Complete","value":',
            _uint2str(percent),
            '}]'
        ));
    }

    function _getBalance(IVault.Attr memory attributes, address vaultAddress) internal view returns (uint256) {
        if (attributes.baseToken == address(0)) {
            return IVault(vaultAddress).getTotalBalance();
        } else {
            return IERC20(attributes.baseToken).balanceOf(vaultAddress);
        }
    }

    // Check if the IERC20 token has a name and symbol
    function _getTokenSymbol(address baseTokenAddress) internal view returns (string memory tokenSymbol) {
        if (baseTokenAddress == address(0)) {
            tokenSymbol = _chainSymbol;
        } else {
            try IExtendedERC20(baseTokenAddress).name() returns (string memory tokenName) {
                try IExtendedERC20(baseTokenAddress).symbol() returns (string memory tokenSym) {
                    tokenSymbol = string(abi.encodePacked(tokenName, ' (', tokenSym, ')'));
                } catch {
                    // Fallback if symbol() is not available but name() is
                    tokenSymbol = tokenName;
                }
            } catch {
                try IExtendedERC20(baseTokenAddress).symbol() returns (string memory tokenSym) {
                    // Fallback if name() is not available but symbol() is
                    tokenSymbol = tokenSym;
                } catch {
                    // Fallback if neither name() nor symbol() is available
                    tokenSymbol = "";
                }
            }
        }
    }

    function _generateSVG(uint256 percent) internal pure returns (bytes memory) {
        return abi.encodePacked(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(string(
                abi.encodePacked(
                    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200" fill="none"><rect width="1200" height="1200" fill="#323D9E"/>',
                    percent > 0 ? _generatePaths(percent) : '',
                    '<text x="600" y="600" fill="#fff" alignment-baseline="middle" text-anchor="middle" font-size="440">',
                    _uint2str(percent),
                    '%</text></svg>'
                )
            )))
        );
    }

    function _generatePaths(uint256 percentage) internal pure returns (string memory pathsString) {
        uint256 pathsToShow = (percentage * 30) / 100; // Calculate paths to display

        for (uint256 i = 0; i < pathsToShow; i++) {
            uint256 yCoordinate = 1200 - (40 * i); // Invert Y-coordinate
            pathsString = string(abi.encodePacked(
                pathsString,
                '<path d="M1200 ', _uint2str(yCoordinate), 'H0V', _uint2str(yCoordinate - 20),
                'H1200V', _uint2str(yCoordinate), 'Z" fill="white"/>\n'
            ));
        }
    }

    /// @dev calculates the percentage towards unlock based on time and target balance
    function _calculatePercent(
        IVault.Attr memory attributes,
        uint256 currentBalance
    ) internal view returns (uint256 percentage) {

        uint256 percentageBasedOnTime = 0;
        uint256 percentageBasedOnBalance = 0;

        if (block.timestamp >= attributes.unlockTime) {
            percentageBasedOnTime = 100;
        } else {
            uint256 totalTime = attributes.unlockTime - attributes.startTime;
            uint256 timeElapsed = block.timestamp - attributes.startTime;
            percentageBasedOnTime = uint256((timeElapsed * 100) / totalTime);
        }

        if (currentBalance >= attributes.targetBalance) {
            percentageBasedOnBalance = 100;
        } else if (attributes.targetBalance > 0 && currentBalance > 0) {
            percentageBasedOnBalance = uint256((currentBalance * 100) / attributes.targetBalance);
        }

        // Return the lower value between percentageBasedOnBalance and percentageBasedOnTime
        percentage = percentageBasedOnBalance < percentageBasedOnTime ? percentageBasedOnBalance : percentageBasedOnTime;
    }

    /*
        UTILS - internal functions only
    */

    function _uint2str(
        uint _i
    ) internal pure returns (string memory _uintAsString) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        {
            uint k = len;
            while (_i != 0) {
                k = k - 1;
                uint8 temp = (48 + uint8(_i - (_i / 10) * 10));
                bytes1 b1 = bytes1(temp);
                bstr[k] = b1;
                _i /= 10;
            }
        }

        return string(bstr);
    }

    function _toAsciiString(address x) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint i = 0; i < 20; i++) {
            bytes1 b = bytes1(uint8(uint(uint160(x)) / (2**(8*(19 - i)))));
            bytes1 hi = bytes1(uint8(b) / 16);
            bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
            s[2*i] = _char(hi);
            s[2*i+1] = _char(lo);            
        }
        return string(s);
    }

    function _char(bytes1 b) internal pure returns (bytes1 c) {
        if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
        else return bytes1(uint8(b) + 0x57);
    }

    function _convertWeiToEthString(uint weiValue) internal pure returns (string memory) {
        // Check if the value is less than 0.00001 ETH (10000000000000 wei)
        if (weiValue < 10000000000000) {
            return "0";
        }
        
        // Truncate the last 14 digits of the wei value
        uint truncatedWeiValue = weiValue / 10000000000000;

        string memory str = _uint2str(truncatedWeiValue);

        // If the length of the string is less than 5, prepend leading zeros
        if (bytes(str).length < 5) {
            uint leadingZeros = 5 - bytes(str).length;
            string memory zeros = new string(leadingZeros);
            bytes memory zerosBytes = bytes(zeros);
            for (uint i = 0; i < leadingZeros; i++) {
                zerosBytes[i] = "0";
            }
            str = string(abi.encodePacked(zerosBytes, bytes(str)));
        }

        uint len = bytes(str).length;

        if (len > 5) {
            // Insert '.' before the last 5 characters
            string memory prefix = _insertCharAtIndex(str,len-5,'.');
            return prefix; 
        } else {
            // Prepend '0.' to the start of the string
            string memory prefix = string(abi.encodePacked("0.", str));
            return prefix;
        }
    }

    function _insertCharAtIndex(string memory str, uint index, bytes1 newChar) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        bytes memory result = new bytes(strBytes.length + 1);
        
        require(index <= strBytes.length, "Invalid index");
        
        for (uint i = 0; i < result.length; i++) {
            if (i < index) {
                result[i] = strBytes[i];
            } else if (i == index) {
                result[i] = newChar;
            } else {
                result[i] = strBytes[i - 1];
            }
        }
        
        return string(result);
    }
}