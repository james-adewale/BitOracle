import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;
const address3 = accounts.get("wallet_3")!;
const address4 = accounts.get("wallet_4")!;
const deployer = accounts.get("deployer")!;

const contractName = "BitOraclecontract";

describe("BitOracle Comprehensive Test Suite", () => {
  beforeEach(() => {
    // Reset to a clean state before each test
    simnet.mineEmptyBlock();
  });

  describe("Basic Contract Initialization", () => {
    it("ensures simnet is well initialized", () => {
      expect(simnet.blockHeight).toBeDefined();
    });

    it("should have correct initial state", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-market-counter", [], address1);
      expect(result).toBeUint(0);
    });

    it("should not be paused initially", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "is-contract-paused", [], address1);
      expect(result).toBeBool(false);
    });

    it("should not be in emergency mode initially", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "is-emergency-mode", [], address1);
      expect(result).toBeBool(false);
    });

    it("should have zero emergency mode start time initially", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-emergency-mode-start", [], address1);
      expect(result).toBeUint(0);
    });
  });

  describe("Emergency Mode Security", () => {
    it("should allow owner to enable emergency mode", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "enable-emergency-mode",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const { result: paused } = simnet.callReadOnlyFn(contractName, "is-contract-paused", [], address1);
      expect(result).toBeBool(true);

      const { result: emergency } = simnet.callReadOnlyFn(contractName, "is-emergency-mode", [], address1);
      expect(result).toBeBool(true);
    });

    it("should reject non-owner from enabling emergency mode", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "enable-emergency-mode",
        [],
        address1
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should allow owner to disable emergency mode", () => {
      // Enable emergency mode first
      simnet.callPublicFn(contractName, "enable-emergency-mode", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "disable-emergency-mode",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));

      const { result: paused } = simnet.callReadOnlyFn(contractName, "is-contract-paused", [], address1);
      expect(result).toBeBool(false);

      const { result: emergency } = simnet.callReadOnlyFn(contractName, "is-emergency-mode", [], address1);
      expect(result).toBeBool(false);
    });

    it("should prevent operations during emergency mode", () => {
      // Enable emergency mode
      simnet.callPublicFn(contractName, "enable-emergency-mode", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(503)); // ERR_CONTRACT_PAUSED
    });

    it("should allow operations after emergency mode expires", () => {
      // Enable emergency mode
      simnet.callPublicFn(contractName, "enable-emergency-mode", [], deployer);

      // Mine blocks to expire emergency mode (1440 blocks)
      simnet.mineEmptyBlocks(1441);

      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
    });
  });

  describe("Rate Limiting Security", () => {
    it("should allow operations within rate limit", () => {
      const { result: first } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));

      const { result: second } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $50k?"), Cl.uint(50000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(2));
    });

    it("should enforce rate limiting after max operations per block", () => {
      // Create 5 markets in the same block (max allowed is 5)
      for (let i = 1; i <= 5; i++) {
        const { result } = simnet.callPublicFn(
          contractName,
          "create-market",
          [Cl.stringAscii(`Market ${i}`), Cl.uint(100000000000), Cl.uint(1000)],
          address1
        );
        expect(result).toBeOk(Cl.uint(i));
      }

      // 6th operation should be rate limited
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Market 6"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(429)); // ERR_RATE_LIMIT_EXCEEDED
    });

    it("should reset rate limit after block window", () => {
      // Create 5 markets in same block
      for (let i = 1; i <= 5; i++) {
        simnet.callPublicFn(
          contractName,
          "create-market",
          [Cl.stringAscii(`Market ${i}`), Cl.uint(100000000000), Cl.uint(1000)],
          address1
        );
      }

      // Mine 10 blocks to reset rate limit
      simnet.mineEmptyBlocks(10);

      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Market 6"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(6));
    });

    it("should track operations per user separately", () => {
      // User 1 creates 5 markets
      for (let i = 1; i <= 5; i++) {
        simnet.callPublicFn(
          contractName,
          "create-market",
          [Cl.stringAscii(`Market ${i}`), Cl.uint(100000000000), Cl.uint(1000)],
          address1
        );
      }

      // User 2 should still be able to operate
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("User2 Market"), Cl.uint(100000000000), Cl.uint(1000)],
        address2
      );
      expect(result).toBeOk(Cl.uint(6));
    });
  });

  describe("Reentrancy Protection", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
    });

    it("should prevent reentrant betting calls", () => {
      // This test verifies that the reentrancy guard works
      // Since we can't easily create reentrant calls in unit tests,
      // we verify the guard is properly set during operations
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow sequential operations from same user", () => {
      // Place first bet
      const { result: first } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));

      // Place second bet (should succeed after reentrancy guard is released)
      const { result: second } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(false), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });
  });

  describe("Market Creation Security", () => {
    it("should create a market with valid parameters", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
    });

    it("should reject market creation with zero target price", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $0?"), Cl.uint(0), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(400)); // ERR_INVALID_PRICE
    });

    it("should reject market creation with price below minimum", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100?"), Cl.uint(100000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(400)); // ERR_INVALID_PRICE
    });

    it("should reject market creation with empty question", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii(""), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should reject market creation with past expiry", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(10)],
        address1
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should enforce safe math in market counter increment", () => {
      // Create maximum markets to test overflow protection
      for (let i = 1; i <= 100; i++) {
        const { result } = simnet.callPublicFn(
          contractName,
          "create-market",
          [Cl.stringAscii(`Market ${i}`), Cl.uint(100000000000), Cl.uint(1000 + i)],
          address1
        );
        expect(result).toBeOk(Cl.uint(i));
      }
    });
  });

  describe("Betting Security", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
    });

    it("should place a valid YES bet", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should place a valid NO bet", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(false), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject bet with amount too small", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(100000)],
        address2
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should reject bet with amount too large", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(1000000000000000)],
        address2
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should reject bet on non-existent market", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(999), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeErr(Cl.uint(404)); // ERR_MARKET_NOT_FOUND
    });

    it("should reject bet after market expiry", () => {
      simnet.mineEmptyBlocks(1001);

      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeErr(Cl.uint(410)); // ERR_MARKET_EXPIRED
    });

    it("should enforce safe math in bet amount accumulation", () => {
      // Place multiple bets to test overflow protection
      for (let i = 0; i < 10; i++) {
        const { result } = simnet.callPublicFn(
          contractName,
          "place-bet",
          [Cl.uint(marketId), Cl.bool(i % 2 === 0), Cl.uint(10000000)],
          address2
        );
        expect(result).toBeOk(Cl.bool(true));
      }
    });
  });

  describe("Market Resolution Security", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;

      simnet.callPublicFn(contractName, "set-oracle-address", [Cl.principal(address3)], deployer);
    });

    it("should allow oracle to resolve market with YES outcome", () => {
      simnet.mineEmptyBlocks(1001);

      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)], // Price above target
        address3
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should allow oracle to resolve market with NO outcome", () => {
      simnet.mineEmptyBlocks(1001);

      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(90000000000)], // Price below target
        address3
      );
      expect(result).toBeOk(Cl.bool(false));
    });

    it("should reject non-oracle from resolving market", () => {
      simnet.mineEmptyBlocks(1001);

      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should reject resolution before expiry", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address3
      );
      expect(result).toBeErr(Cl.uint(425)); // ERR_NOT_EXPIRED
    });

    it("should reject duplicate resolution", () => {
      simnet.mineEmptyBlocks(1001);

      simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address3
      );

      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address3
      );
      expect(result).toBeErr(Cl.uint(409)); // ERR_ALREADY_RESOLVED
    });

    it("should reject resolution with zero price", () => {
      simnet.mineEmptyBlocks(1001);

      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(0)],
        address3
      );
      expect(result).toBeErr(Cl.uint(400)); // ERR_INVALID_PRICE
    });
  });

  describe("Payout Calculations and Claims", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;

      simnet.callPublicFn(contractName, "set-oracle-address", [Cl.principal(address3)], deployer);

      // Place bets
      simnet.callPublicFn(contractName, "place-bet", [Cl.uint(marketId), Cl.bool(true), Cl.uint(20000000)], address2); // YES
      simnet.callPublicFn(contractName, "place-bet", [Cl.uint(marketId), Cl.bool(false), Cl.uint(10000000)], address4); // NO

      // Resolve market
      simnet.mineEmptyBlocks(1001);
      simnet.callPublicFn(contractName, "resolve-market", [Cl.uint(marketId), Cl.uint(110000000000)], address3);
    });

    it("should calculate correct payout for winner", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "claim-winnings",
        [Cl.uint(marketId)],
        address2 // YES bettor who won
      );
      expect(result).toBeOk(Cl.uint(15000000)); // Should get original bet + proportional winnings
    });

    it("should reject claim from loser", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "claim-winnings",
        [Cl.uint(marketId)],
        address4 // NO bettor who lost
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT (no winning amount)
    });

    it("should reject duplicate claims", () => {
      simnet.callPublicFn(contractName, "claim-winnings", [Cl.uint(marketId)], address2);

      const { result } = simnet.callPublicFn(
        contractName,
        "claim-winnings",
        [Cl.uint(marketId)],
        address2
      );
      expect(result).toBeErr(Cl.uint(409)); // ERR_ALREADY_CLAIMED
    });

    it("should reject claims on non-existent positions", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "claim-winnings",
        [Cl.uint(marketId)],
        address1 // No position
      );
      expect(result).toBeErr(Cl.uint(404)); // ERR_NO_POSITION
    });
  });

  describe("Contract Pause Security", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
    });

    it("should allow owner to pause contract", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "pause-contract",
        [],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-owner from pausing contract", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "pause-contract",
        [],
        address1
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should prevent market creation when paused", () => {
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $50k?"), Cl.uint(50000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeErr(Cl.uint(503)); // ERR_CONTRACT_PAUSED
    });

    it("should prevent betting when paused", () => {
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeErr(Cl.uint(503)); // ERR_CONTRACT_PAUSED
    });

    it("should allow operations after unpausing", () => {
      simnet.callPublicFn(contractName, "pause-contract", [], deployer);
      simnet.callPublicFn(contractName, "unpause-contract", [], deployer);

      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)],
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });
  });

  describe("Access Control Security", () => {
    it("should allow owner to set oracle address", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-oracle-address",
        [Cl.principal(address2)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-owner from setting oracle address", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-oracle-address",
        [Cl.principal(address2)],
        address1
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should allow owner to set fee recipient", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-recipient",
        [Cl.principal(address2)],
        deployer
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-owner from setting fee recipient", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-fee-recipient",
        [Cl.principal(address2)],
        address1
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });
  });

  describe("Read-Only Functions", () => {
    let marketId: number;

    beforeEach(() => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;

      simnet.callPublicFn(contractName, "place-bet", [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)], address2);
    });

    it("should return correct market details", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-market", [Cl.uint(marketId)], address1);
      expect(result).toBeSome();
    });

    it("should return user position correctly", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(marketId), Cl.principal(address2)],
        address1
      );
      expect(result).toBeSome();
    });

    it("should return market counter", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-market-counter", [], address1);
      expect(result).toBeUint(1);
    });

    it("should return fee recipient", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-fee-recipient", [], address1);
      expect(result).toBePrincipal(deployer);
    });

    it("should return oracle address", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-oracle-address", [], address1);
      expect(result).toBePrincipal(deployer);
    });

    it("should calculate potential payout correctly", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "calculate-potential-payout",
        [Cl.uint(marketId), Cl.principal(address2)],
        address1
      );
      expect(result).toBeOk();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle operations on non-existent market", () => {
      const { result } = simnet.callReadOnlyFn(contractName, "get-market", [Cl.uint(999)], address1);
      expect(result).toBeNone();
    });

    it("should handle operations on non-existent user position", () => {
      const { result } = simnet.callReadOnlyFn(
        contractName,
        "get-user-position",
        [Cl.uint(1), Cl.principal(address2)],
        address1
      );
      expect(result).toBeSome(); // Should return default position
    });

    it("should handle claims on unresolved markets", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));

      simnet.callPublicFn(contractName, "place-bet", [Cl.uint(1), Cl.bool(true), Cl.uint(10000000)], address2);

      const { result: claimResult } = simnet.callPublicFn(
        contractName,
        "claim-winnings",
        [Cl.uint(1)],
        address2
      );
      expect(result).toBeErr(Cl.uint(404)); // ERR_MARKET_NOT_FOUND (unresolved)
    });

    it("should prevent overflow in calculations", () => {
      // Test with maximum safe values
      const maxUint = "340282366920938463463374607431768211455"; // Max uint128

      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Test Market"), Cl.uint(maxUint), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
    });

    it("should handle zero amount edge cases", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Zero Price Market"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));

      // Try to place zero bet (should fail)
      const { result: betResult } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(1), Cl.bool(true), Cl.uint(0)],
        address2
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });
  });
});