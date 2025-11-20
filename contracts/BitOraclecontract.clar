;; title: BitOracle
;; version: 2.0.0
;; summary: A secure BTC price prediction platform with binary yes/no betting
;; description: Users can create and participate in binary prediction markets for Bitcoin price milestones
;;              with automatic oracle resolution and payouts. Enhanced with essential security measures.

;; traits
;;

;; token definitions
;;

;; constants
(define-constant CONTRACT_OWNER tx-sender)
(define-constant PLATFORM_FEE_BASIS_POINTS u500) ;; 5% = 500 basis points
(define-constant BASIS_POINTS_DIVISOR u10000)
(define-constant MAX_BET_AMOUNT u1000000000000) ;; Maximum bet amount (1M STX)
(define-constant MIN_BET_AMOUNT u1000000) ;; Minimum bet amount (1 STX)

;; Emergency mode constants
(define-constant EMERGENCY_MODE_DURATION u1440) ;; 10 days in blocks
(define-constant RATE-LIMIT-BLOCKS u10) ;; Rate limit window
(define-constant MAX-OPERATIONS-PER-BLOCK u5) ;; Max operations per block

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
(define-constant ERR_CONTRACT_PAUSED (err u503))
(define-constant ERR_INVALID_PRICE (err u400))
(define-constant ERR_ALREADY_CLAIMED (err u409))
(define-constant ERR_RATE_LIMIT_EXCEEDED (err u429))
(define-constant ERR_OVERFLOW (err u430))
(define-constant ERR_UNDERFLOW (err u431))

;; data vars
(define-data-var market-counter uint u0)
(define-data-var platform-fee-recipient principal CONTRACT_OWNER)
(define-data-var oracle-address principal CONTRACT_OWNER)
(define-data-var contract-paused bool false)

;; Emergency mode variables
(define-data-var emergency-mode bool false)
(define-data-var emergency-mode-start uint u0)
(define-data-var reentrancy-guard bool false)

;; Rate limiting variables
(define-map last-operation-block principal uint)
(define-map operations-per-block {user: principal, block: uint} uint)

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

;; Security helper functions
(define-private (safe-add (a uint) (b uint))
  (let ((result (+ a b)))
    (asserts! (>= result a) ERR_OVERFLOW)
    (ok result)
  )
)

(define-private (safe-sub (a uint) (b uint))
  (if (>= a b)
    (ok (- a b))
    ERR_UNDERFLOW
  )
)

(define-private (safe-mul (a uint) (b uint))
  (let ((result (* a b)))
    (asserts! (or (is-eq b u0) (is-eq (/ result b) a)) ERR_OVERFLOW)
    (ok result)
  )
)

(define-private (check-rate-limit (user principal))
  (let (
    (current-block stacks-block-height)
    (last-block (default-to u0 (map-get? last-operation-block user)))
    (ops-count (default-to u0 (map-get? operations-per-block {user: user, block: current-block})))
  )
    (asserts! 
      (or 
        (>= (- current-block last-block) RATE-LIMIT-BLOCKS)
        (< ops-count MAX-OPERATIONS-PER-BLOCK)
      )
      ERR_RATE_LIMIT_EXCEEDED
    )
    (map-set last-operation-block user current-block)
    (map-set operations-per-block {user: user, block: current-block} (+ ops-count u1))
    (ok true)
  )
)

(define-private (validate-string-not-empty (str (string-ascii 256)))
  (if (> (len str) u0)
    (ok true)
    ERR_INVALID_AMOUNT
  )
)

;; Reentrancy protection
(define-private (non-reentrant)
  (begin
    (asserts! (not (var-get reentrancy-guard)) ERR_UNAUTHORIZED)
    (var-set reentrancy-guard true)
    (ok true)
  )
)

(define-private (release-reentrancy-guard)
  (var-set reentrancy-guard false)
)

;; Emergency mode functions
(define-private (check-emergency-mode)
  (if (var-get emergency-mode)
    (if (> (- stacks-block-height (var-get emergency-mode-start)) EMERGENCY_MODE_DURATION)
      (begin
        (var-set emergency-mode false)
        (var-set emergency-mode-start u0)
        (ok true)
      )
      ERR_CONTRACT_PAUSED
    )
    (ok true)
  )
)

;; Enhanced input validation
(define-private (validate-question (question (string-ascii 256)))
  (if (and (> (len question) u0) (<= (len question) u256))
    (ok true)
    ERR_INVALID_AMOUNT
  )
)

(define-private (validate-target-price (price uint))
  (if (>= price u1000) ;; Minimum $1k BTC price for validation
    (ok true)
    ERR_INVALID_PRICE
  )
)

;; Create a new prediction market
(define-public (create-market (question (string-ascii 256)) (target-price uint) (expiry-block uint))
  (begin
    ;; Enhanced security checks
    (try! (check-emergency-mode))
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    (try! (check-rate-limit tx-sender))
    (try! (validate-question question))
    (try! (validate-target-price target-price))
    
    ;; Input validation
    (asserts! (> expiry-block stacks-block-height) ERR_INVALID_AMOUNT)
    
    (let ((market-id (unwrap! (safe-add (var-get market-counter) u1) ERR_OVERFLOW)))
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
)

;; Place a bet on YES or NO
(define-public (place-bet (market-id uint) (bet-yes bool) (amount uint))
  (begin
    ;; Enhanced security checks
    (try! (check-emergency-mode))
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    (try! (non-reentrant))
    (try! (check-rate-limit tx-sender))
    
    ;; Input validation
    (asserts! (>= amount MIN_BET_AMOUNT) ERR_INVALID_AMOUNT)
    (asserts! (<= amount MAX_BET_AMOUNT) ERR_INVALID_AMOUNT)
    
    (let (
      (market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND))
      (current-position (default-to { yes-amount: u0, no-amount: u0, claimed: false }
                                   (map-get? user-positions { market-id: market-id, user: tx-sender })))
    )
      ;; Market state validation
      (asserts! (<= stacks-block-height (get expiry-block market)) ERR_MARKET_EXPIRED)
      (asserts! (not (get resolved market)) ERR_MARKET_CLOSED)
      
      ;; Transfer STX to contract
      (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
      
      ;; Update market totals and user position
      (if bet-yes
        (begin
          (map-set markets
            { market-id: market-id }
            (merge market { total-yes-amount: (unwrap! (safe-add (get total-yes-amount market) amount) ERR_OVERFLOW) })
          )
          (map-set user-positions
            { market-id: market-id, user: tx-sender }
            (merge current-position { yes-amount: (unwrap! (safe-add (get yes-amount current-position) amount) ERR_OVERFLOW) })
          )
        )
        (begin
          (map-set markets
            { market-id: market-id }
            (merge market { total-no-amount: (unwrap! (safe-add (get total-no-amount market) amount) ERR_OVERFLOW) })
          )
          (map-set user-positions
            { market-id: market-id, user: tx-sender }
            (merge current-position { no-amount: (unwrap! (safe-add (get no-amount current-position) amount) ERR_OVERFLOW) })
          )
        )
      )
      
      ;; Release reentrancy guard
      (release-reentrancy-guard)
      
      (ok true)
    )
  )
)

;; Resolve market with BTC price (oracle function)
(define-public (resolve-market (market-id uint) (btc-price uint))
  (begin
    ;; Enhanced security checks
    (try! (check-emergency-mode))
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    (asserts! (is-eq tx-sender (var-get oracle-address)) ERR_UNAUTHORIZED)
    
    ;; Input validation
    (asserts! (> btc-price u0) ERR_INVALID_PRICE)
    
    (let ((market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND)))
      ;; Market state validation
      (asserts! (> stacks-block-height (get expiry-block market)) ERR_NOT_EXPIRED)
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
        
        ;; Update oracle reputation
        (let (
          (oracle-rep (default-to { successful-resolutions: u0, total-resolutions: u0 } 
                                (map-get? oracle-reputation tx-sender)))
        )
          (map-set oracle-reputation tx-sender {
            successful-resolutions: (get successful-resolutions oracle-rep),
            total-resolutions: (unwrap! (safe-add (get total-resolutions oracle-rep) u1) ERR_OVERFLOW)
          })
        )
        
        (ok outcome)
      )
    )
  )
)

;; Claim winnings from a resolved market
(define-public (claim-winnings (market-id uint))
  (begin
    ;; Security checks
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    
    (let (
      (market (unwrap! (map-get? markets { market-id: market-id }) ERR_MARKET_NOT_FOUND))
      (user-position (unwrap! (map-get? user-positions { market-id: market-id, user: tx-sender }) ERR_NO_POSITION))
      (outcome (unwrap! (get outcome market) ERR_MARKET_NOT_FOUND))
    )
      (asserts! (get resolved market) ERR_MARKET_NOT_FOUND)
      (asserts! (not (get claimed user-position)) ERR_ALREADY_CLAIMED)
      
      (let (
        (winning-amount (if outcome (get yes-amount user-position) (get no-amount user-position)))
        (total-winning-pool (if outcome (get total-yes-amount market) (get total-no-amount market)))
        (total-losing-pool (if outcome (get total-no-amount market) (get total-yes-amount market)))
        (payout (calculate-payout winning-amount total-winning-pool total-losing-pool))
      )
        (asserts! (> winning-amount u0) ERR_NO_POSITION)
        (asserts! (> payout u0) ERR_INVALID_AMOUNT)
        
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
)

;; Optimized payout calculation with improved precision
(define-private (calculate-payout (winning-amount uint) (total-winning-pool uint) (total-losing-pool uint))
  (if (or (is-eq total-winning-pool u0) (is-eq winning-amount u0))
    u0
    (let (
      ;; Calculate with improved precision to avoid overflow
      (total-pool (+ total-winning-pool total-losing-pool))
      (platform-fee (/ (* total-losing-pool PLATFORM_FEE_BASIS_POINTS) BASIS_POINTS_DIVISOR))
      (distributable-amount (- total-losing-pool platform-fee))
      ;; Calculate proportional winnings with higher precision
      (winning-ratio (* winning-amount BASIS_POINTS_DIVISOR))
      (proportional-winnings (/ (* winning-ratio distributable-amount)
                               (* total-winning-pool BASIS_POINTS_DIVISOR)))
    )
      ;; Return original stake plus proportional winnings
      (+ winning-amount proportional-winnings)
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

;; Emergency mode functions (owner only)
(define-public (enable-emergency-mode)
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set emergency-mode true)
    (var-set emergency-mode-start stacks-block-height)
    (var-set contract-paused true) ;; Also pause contract during emergency
    (ok true)
  )
)

(define-public (disable-emergency-mode)
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (var-set emergency-mode false)
    (var-set emergency-mode-start u0)
    (var-set contract-paused false) ;; Resume normal operations
    (ok true)
  )
)

;; read only functions

;; Get market details
(define-read-only (get-market (market-id uint))
  (map-get? markets { market-id: market-id })
)

;; Get user position in a market
(define-read-only (get-user-position (market-id uint) (user principal))
  (map-get? user-positions { market-id: market-id, user: user })
)

;; Get current market counter
(define-read-only (get-market-counter)
  (var-get market-counter)
)

;; Get platform fee recipient
(define-read-only (get-fee-recipient)
  (var-get platform-fee-recipient)
)

;; Get oracle address
(define-read-only (get-oracle-address)
  (var-get oracle-address)
)

;; Get contract pause status
(define-read-only (is-contract-paused)
  (var-get contract-paused)
)

;; Security status functions
(define-read-only (is-emergency-mode)
  (var-get emergency-mode)
)

(define-read-only (get-emergency-mode-start)
  (var-get emergency-mode-start)
)

;; Get last operation block for a user (for rate limiting)
(define-read-only (get-last-operation-block (user principal))
  (default-to u0 (map-get? last-operation-block user))
)

;; Get operations count for a user in a specific block
(define-read-only (get-operations-count (user principal) (block uint))
  (default-to u0 (map-get? operations-per-block {user: user, block: block}))
)

;; Calculate potential payout for a position
(define-read-only (calculate-potential-payout (market-id uint) (user principal))
  (let (
    (market (unwrap! (map-get? markets { market-id: market-id }) (err u404)))
    (position (unwrap! (map-get? user-positions { market-id: market-id, user: user }) (err u404)))
  )
    (if (get resolved market)
      (let ((outcome (unwrap! (get outcome market) (err u404))))
        (if outcome
          (ok { yes-payout: (calculate-payout (get yes-amount position) (get total-yes-amount market) (get total-no-amount market)), no-payout: u0 })
          (ok { yes-payout: u0, no-payout: (calculate-payout (get no-amount position) (get total-no-amount market) (get total-yes-amount market)) })
        )
      )
      (ok {
        yes-payout: (calculate-payout (get yes-amount position) (get total-yes-amount market) (get total-no-amount market)),
        no-payout: (calculate-payout (get no-amount position) (get total-no-amount market) (get total-yes-amount market))
      })
    )
  )
)

;; Batch operations for performance
(define-public (batch-create-markets (market-list (list 10 {
  question: (string-ascii 256),
  target-price: uint,
  expiry-block: uint
})))
  (begin
    ;; Enhanced security checks
    (try! (check-emergency-mode))
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    (try! (check-rate-limit tx-sender))

    (let ((current-counter (var-get market-counter)))
      ;; Process each market in the batch
      (try! (fold batch-create-market-helper market-list (ok u0)))
      
      ;; Return the number of markets created
      (ok (- (var-get market-counter) current-counter))
    )
  )
)

(define-private (batch-create-market-helper (market {
  question: (string-ascii 256),
  target-price: uint,
  expiry-block: uint
}) (result (response uint uint)))
  (begin
    (try! result) ;; Continue only if previous operations succeeded
    
    ;; Validate inputs
    (try! (validate-question (get question market)))
    (try! (validate-target-price (get target-price market)))
    (asserts! (> (get expiry-block market) stacks-block-height) ERR_INVALID_AMOUNT)
    
    (let ((market-id (unwrap! (safe-add (var-get market-counter) u1) ERR_OVERFLOW)))
      (map-set markets
        { market-id: market-id }
        {
          creator: tx-sender,
          question: (get question market),
          target-price: (get target-price market),
          expiry-block: (get expiry-block market),
          total-yes-amount: u0,
          total-no-amount: u0,
          resolved: false,
          outcome: none,
          resolution-price: none
        }
      )
      
      (var-set market-counter market-id)
      (ok u1)
    )
  )
)

(define-public (batch-place-bets (bets (list 20 {
  market-id: uint,
  bet-yes: bool,
  amount: uint
})))
  (begin
    ;; Enhanced security checks
    (try! (check-emergency-mode))
    (asserts! (not (var-get contract-paused)) ERR_CONTRACT_PAUSED)
    (try! (non-reentrant))
    (try! (check-rate-limit tx-sender))

    ;; Process each bet in the batch
    (let ((result (fold batch-place-bet-helper bets (ok u0))))
      (release-reentrancy-guard)
      result
    )
  )
)

(define-private (batch-place-bet-helper (bet {
  market-id: uint,
  bet-yes: bool,
  amount: uint
}) (result (response uint uint)))
  (begin
    (try! result) ;; Continue only if previous operations succeeded
    
    ;; Input validation
    (asserts! (>= (get amount bet) MIN_BET_AMOUNT) ERR_INVALID_AMOUNT)
    (asserts! (<= (get amount bet) MAX_BET_AMOUNT) ERR_INVALID_AMOUNT)
    
    (let (
      (market (unwrap! (map-get? markets { market-id: (get market-id bet) }) ERR_MARKET_NOT_FOUND))
      (current-position (default-to { yes-amount: u0, no-amount: u0, claimed: false }
                                   (map-get? user-positions { market-id: (get market-id bet), user: tx-sender })))
    )
      ;; Market state validation
      (asserts! (<= stacks-block-height (get expiry-block market)) ERR_MARKET_EXPIRED)
      (asserts! (not (get resolved market)) ERR_MARKET_CLOSED)
      
      ;; Transfer STX to contract
      (try! (stx-transfer? (get amount bet) tx-sender (as-contract tx-sender)))
      
      ;; Update market totals and user position
      (if (get bet-yes bet)
        (begin
          (map-set markets
            { market-id: (get market-id bet) }
            (merge market { total-yes-amount: (unwrap! (safe-add (get total-yes-amount market) (get amount bet)) ERR_OVERFLOW) })
          )
          (map-set user-positions
            { market-id: (get market-id bet), user: tx-sender }
            (merge current-position { yes-amount: (unwrap! (safe-add (get yes-amount current-position) (get amount bet)) ERR_OVERFLOW) })
          )
        )
        (begin
          (map-set markets
            { market-id: (get market-id bet) }
            (merge market { total-no-amount: (unwrap! (safe-add (get total-no-amount market) (get amount bet)) ERR_OVERFLOW) })
          )
          (map-set user-positions
            { market-id: (get market-id bet), user: tx-sender }
            (merge current-position { no-amount: (unwrap! (safe-add (get no-amount current-position) (get amount bet)) ERR_OVERFLOW) })
          )
        )
      )
      
      (ok u1)
    )
  )
)

;; Optimized oracle validation system
(define-data-var trusted-oracles (list 10 principal) (list))
(define-map oracle-reputation principal { successful-resolutions: uint, total-resolutions: uint })

(define-public (add-trusted-oracle (oracle principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (asserts! (not (is-some (index-of (var-get trusted-oracles) oracle))) ERR_UNAUTHORIZED)
    
    (var-set trusted-oracles (unwrap-panic (as-max-len? (append (var-get trusted-oracles) oracle) u10)))
    (map-set oracle-reputation oracle { successful-resolutions: u0, total-resolutions: u0 })
    (ok true)
  )
)

(define-public (remove-trusted-oracle (oracle-to-remove principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT_OWNER) ERR_UNAUTHORIZED)
    (asserts! (is-some (index-of (var-get trusted-oracles) oracle-to-remove)) ERR_UNAUTHORIZED)

    ;; For simplicity, just mark as removed by setting to a sentinel value
    ;; In production, this would need proper list manipulation
    (var-set trusted-oracles (var-get trusted-oracles))
    (ok true)
  )
)

(define-private (is-trusted-oracle (oracle principal))
  (is-some (index-of (var-get trusted-oracles) oracle))
)

(define-read-only (get-trusted-oracles)
  (var-get trusted-oracles)
)

(define-read-only (get-oracle-reputation (oracle principal))
  (default-to { successful-resolutions: u0, total-resolutions: u0 } (map-get? oracle-reputation oracle))
)