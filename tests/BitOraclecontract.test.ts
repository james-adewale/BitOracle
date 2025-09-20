import { describe, expect, it, beforeEach } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const address1 = accounts.get("wallet_1")!;
const address2 = accounts.get("wallet_2")!;
const address3 = accounts.get("wallet_3")!;
const deployer = accounts.get("deployer")!;

const contractName = "BitOraclecontract";

describe("BitOracle Security Tests", () => {
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
  });

  describe("Betting Security", () => {
    let marketId: number;

    beforeEach(() => {
      // Create a market for betting tests
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
    });

    it("should place a valid bet", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(10000000)], // 10 STX bet
        address2
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject bet with amount too small", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(100000)], // Too small bet
        address2
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should reject bet with amount too large", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(marketId), Cl.bool(true), Cl.uint(1000000000000000)], // Too large bet
        address2
      );
      expect(result).toBeErr(Cl.uint(403)); // ERR_INVALID_AMOUNT
    });

    it("should reject bet on non-existent market", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "place-bet",
        [Cl.uint(999), Cl.bool(true), Cl.uint(10000000)], // Non-existent market
        address2
      );
      expect(result).toBeErr(Cl.uint(404)); // ERR_MARKET_NOT_FOUND
    });
  });

  describe("Access Control Security", () => {
    it("should allow only owner to set oracle address", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-oracle-address",
        [Cl.principal(address2)],
        deployer // Owner
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-owner from setting oracle address", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "set-oracle-address",
        [Cl.principal(address2)],
        address1 // Non-owner
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should allow only owner to pause contract", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "pause-contract",
        [],
        deployer // Owner
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-owner from pausing contract", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "pause-contract",
        [],
        address1 // Non-owner
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });
  });

  describe("Contract Pause Security", () => {
    let marketId: number;

    beforeEach(() => {
      // Create a market for pause tests
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
    });

    it("should prevent market creation when paused", () => {
      // Pause the contract
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
      // Pause the contract
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
      // Pause and then unpause
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

  describe("Market Resolution Security", () => {
    let marketId: number;

    beforeEach(() => {
      // Create a market and set oracle
      const { result } = simnet.callPublicFn(
        contractName,
        "create-market",
        [Cl.stringAscii("Will BTC reach $100k?"), Cl.uint(100000000000), Cl.uint(1000)],
        address1
      );
      expect(result).toBeOk(Cl.uint(1));
      marketId = 1;
      
      // Set oracle address
      simnet.callPublicFn(contractName, "set-oracle-address", [Cl.principal(address3)], deployer);
    });

    it("should allow only oracle to resolve market", () => {
      // Mine blocks to make market expired
      simnet.mineEmptyBlocks(1001);
      
      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)], // BTC price above target
        address3 // Oracle
      );
      expect(result).toBeOk(Cl.bool(true));
    });

    it("should reject non-oracle from resolving market", () => {
      // Mine blocks to make market expired
      simnet.mineEmptyBlocks(1001);
      
      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address1 // Non-oracle
      );
      expect(result).toBeErr(Cl.uint(401)); // ERR_UNAUTHORIZED
    });

    it("should reject resolution before expiry", () => {
      const { result } = simnet.callPublicFn(
        contractName,
        "resolve-market",
        [Cl.uint(marketId), Cl.uint(110000000000)],
        address3 // Oracle
      );
      expect(result).toBeErr(Cl.uint(425)); // ERR_NOT_EXPIRED
    });
  });
});