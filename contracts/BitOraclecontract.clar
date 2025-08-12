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


;; public functions

;; Create a new prediction market
(define-public (create-market (question (string-ascii 256)) (target-price uint) (expiry-block uint))
  (let ((market-id (+ (var-get market-counter) u1)))
    (asserts! (> expiry-block block-height) (err u400))
    (asserts! (> target-price u0) (err u400))
    
    (map-set markets
      { market-id: market-id }
      {
        creator: tx-sender,
        question: question,
        target-price: target-price,
        expiry-block: expiry-block,
        total-yes-amount: u0,
        total-no-amount: u0,
        resolved: false,
        outcome: none,
        resolution-price: none
      }
    )
    
    (var-set market-counter market-id)
    (ok market-id)
  )
)

;; Place a bet on YES or NO
(define-public (place-bet (market-id uint) (bet-yes bool) (amount uint))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND))
    (current-position (default-to { yes-amount: u0, no-amount: u0, claimed: false }
                                 (map-get? user-positions { market-id: market-id, user: tx-sender })))
  )
    (asserts! (> amount u0) ERR_INVALID_AMOUNT)
    (asserts! (<= block-height (get expiry-block market)) ERR_MARKET_EXPIRED)
    (asserts! (not (get resolved market)) ERR_MARKET_CLOSED)
    
    ;; Transfer STX to contract
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    
    ;; Update market totals and user position
    (if bet-yes
      (begin
        (map-set markets
          { market-id: market-id }
          (merge market { total-yes-amount: (+ (get total-yes-amount market) amount) })
        )
        (map-set user-positions
          { market-id: market-id, user: tx-sender }
          (merge current-position { yes-amount: (+ (get yes-amount current-position) amount) })
        )
      )
      (begin
        (map-set markets
          { market-id: market-id }
          (merge market { total-no-amount: (+ (get total-no-amount market) amount) })
        )
        (map-set user-positions
          { market-id: market-id, user: tx-sender }
          (merge current-position { no-amount: (+ (get no-amount current-position) amount) })
        )
      )
    )
    
    (ok true)
  )
)

;; Resolve market with BTC price (oracle function)
(define-public (resolve-market (market-id uint) (btc-price uint))
  (let ((market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND)))
    (asserts! (is-eq tx-sender (var-get oracle-address)) ERR_UNAUTHORIZED)
    (asserts! (> block-height (get expiry-block market)) ERR_NOT_EXPIRED)
    (asserts! (not (get resolved market)) ERR_ALREADY_RESOLVED)
    
    (let ((outcome (>= btc-price (get target-price market))))
      (map-set markets
        { market-id: market-id }
        (merge market {
          resolved: true,
          outcome: (some outcome),
          resolution-price: (some btc-price)
        })
      )
      
      (ok outcome)
    )
  )
)

;; Claim winnings from a resolved market
(define-public (claim-winnings (market-id uint))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND))
    (user-position (unwrap! (map-get? user-positions { market-id: market-id, user: tx-sender }) ERR_NO_POSITION))
    (outcome (unwrap! (get outcome market) ERR_MARKET_NOT_FOUND))
  )
    (asserts! (get resolved market) ERR_MARKET_NOT_FOUND)
    (asserts! (not (get claimed user-position)) ERR_ALREADY_RESOLVED)
    
    (let (
      (winning-amount (if outcome (get yes-amount user-position) (get no-amount user-position)))
      (total-winning-pool (if outcome (get total-yes-amount market) (get total-no-amount market)))
      (total-losing-pool (if outcome (get total-no-amount market) (get total-yes-amount market)))
      (payout (calculate-payout winning-amount total-winning-pool total-losing-pool))
    )
      (asserts! (> winning-amount u0) ERR_NO_POSITION)
      
      ;; Mark as claimed
      (map-set user-positions
        { market-id: market-id, user: tx-sender }
        (merge user-position { claimed: true })
      )
      
      ;; Transfer winnings
      (try! (as-contract (stx-transfer? payout tx-sender tx-sender)))
      
      (ok payout)
    )
  )
)

;; Update oracle address (only owner)
(define-public (set-oracle-address (new-oracle principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set oracle-address new-oracle)
    (ok true)
  )
)

;; Update platform fee recipient (only owner)
(define-public (set-fee-recipient (new-recipient principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set platform-fee-recipient new-recipient)
    (ok true)
  )
)
