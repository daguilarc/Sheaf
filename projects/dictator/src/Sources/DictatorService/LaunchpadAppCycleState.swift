import Darwin

enum LaunchpadAppCycleDirection {
    case forward
    case backward
}

struct LaunchpadAppCycleSession {
    let frozenCandidatePIDs: [pid_t]
    private(set) var currentIndex: Int
    private var isFirstStepPending = true

    init?(frozenCandidatePIDs: [pid_t], currentPID: pid_t?) {
        guard !frozenCandidatePIDs.isEmpty else {
            return nil
        }
        self.frozenCandidatePIDs = frozenCandidatePIDs
        if let currentPID, let index = frozenCandidatePIDs.firstIndex(of: currentPID) {
            currentIndex = index
        } else {
            currentIndex = 0
        }
    }

    mutating func step(_ direction: LaunchpadAppCycleDirection, currentPID: pid_t? = nil) -> pid_t {
        if isFirstStepPending {
            if let currentPID, let index = frozenCandidatePIDs.firstIndex(of: currentPID) {
                currentIndex = index
            }
            isFirstStepPending = false
        }

        let count = frozenCandidatePIDs.count
        switch direction {
        case .forward:
            currentIndex = (currentIndex + 1) % count
        case .backward:
            currentIndex = (currentIndex - 1 + count) % count
        }
        return frozenCandidatePIDs[currentIndex]
    }
}

struct LaunchpadAppCycleState {
    private(set) var session: LaunchpadAppCycleSession?

    var isActive: Bool {
        session != nil
    }

    var candidateCount: Int {
        session?.frozenCandidatePIDs.count ?? 0
    }

    mutating func start(with frozenCandidatePIDs: [pid_t], currentPID: pid_t?) -> Bool {
        guard let session = LaunchpadAppCycleSession(frozenCandidatePIDs: frozenCandidatePIDs, currentPID: currentPID) else {
            self.session = nil
            return false
        }
        self.session = session
        return true
    }

    mutating func step(_ direction: LaunchpadAppCycleDirection, currentPID: pid_t? = nil) -> pid_t? {
        guard var session else {
            return nil
        }
        let pid = session.step(direction, currentPID: currentPID)
        self.session = session
        return pid
    }

    mutating func stop() {
        session = nil
    }
}
