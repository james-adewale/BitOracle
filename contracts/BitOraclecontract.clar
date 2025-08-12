;; title: BitOracle
;; version: 1.0.0
;; summary: A simplified BTC price prediction platform with binary yes/no betting
;; description: Users can create and participate in binary prediction markets for Bitcoin price milestones
;;              with automatic oracle resolution and payouts

;; traits
;;

;; token definitions
;;

;; constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant PLATFORM_FEE_BASIS_POINTS u500) ;; 5% = 500 basis points
(define-constant BASIS_POINTS_DIVISOR u10000)

;; Error codes
(define-constant ERR_UNAUTHORIZED (err u401))
(define-constant ERR_MARKET_NOT_FOUND (err u404))
(define-constant ERR_MARKET_CLOSED (err u400))
(define-constant ERR_MARKET_EXPIRED (err u410))
(define-constant ERR_INSUFFICIENT_FUNDS (err u402))
(define-constant ERR_INVALID_AMOUNT (err u403))
(define-constant ERR_ALREADY_RESOLVED (err u409))
(define-constant ERR_NOT_EXPIRED (err u425))
(define-constant ERR_INVALID_OUTCOME (err u422))
(define-constant ERR_NO_POSITION (err u404))
(define-constant ERR_TRANSFER_FAILED (err u500))

;; data vars
(define-data-var market-counter uint u0)
(define-data-var platform-fee-recipient principal CONTRACT_OWNER)
(define-data-var oracle-address principal CONTRACT_OWNER)

;; data maps
(define-map markets
  { market-id: uint }
  {
    creator: principal,
    question: (string-ascii 256),
    target-price: uint,
    expiry-block: uint,
    total-yes-amount: uint,
    total-no-amount: uint,
    resolved: bool,
    outcome: (optional bool), ;; true for YES, false for NO
    resolution-price: (optional uint)
  }
)

(define-map user-positions
  { market-id: uint, user: principal }
  {
    yes-amount: uint,
    no-amount: uint,
    claimed: bool
  }
)
