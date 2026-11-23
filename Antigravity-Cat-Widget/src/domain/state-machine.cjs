// Production state machine and event arbiter for Antigravity Cat Widget
// Strictly decoupled from visual rendering; purely functional and deterministic.

const VALID_PERSISTENT_STATES = new Set(["idle", "thinking", "warning", "error", "offline"]);
const VALID_TRANSIENT_STATES = new Set(["pressed", "release", "petting", "success", "error"]);

class WidgetStateMachine {
  constructor(initialState = "idle") {
    this.persistentState = VALID_PERSISTENT_STATES.has(initialState) ? initialState : "idle";
    this.transientState = null;
    this.transientTimer = null;
    this.listeners = new Set();
    this.lastPettingTime = 0;
    this.pettingCooldownMs = 12000; // 12 seconds cooldown between petting reactions
  }

  get currentState() {
    return this.transientState || this.persistentState;
  }

  get isTransient() {
    return this.transientState !== null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    const state = this.currentState;
    for (const listener of this.listeners) {
      try {
        listener(state, {
          persistent: this.persistentState,
          transient: this.transientState
        });
      } catch (err) {
        console.error("[StateMachine] Listener error:", err);
      }
    }
  }

  // Set persistent business state (e.g. agent working, quota low, idle)
  setPersistentState(state) {
    if (!VALID_PERSISTENT_STATES.has(state)) {
      console.warn(`[StateMachine] Invalid persistent state: ${state}`);
      return;
    }
    if (this.persistentState === state) return;

    this.persistentState = state;
    // If no transient override is active, notify immediately
    if (!this.transientState) {
      this._notify();
    }
  }

  // Trigger transient reaction (e.g. press, release, turn complete, petting)
  triggerTransient(state, durationMs = 0) {
    if (!VALID_TRANSIENT_STATES.has(state)) {
      console.warn(`[StateMachine] Invalid transient state: ${state}`);
      return;
    }

    if (this.transientTimer) {
      clearTimeout(this.transientTimer);
      this.transientTimer = null;
    }

    this.transientState = state;
    this._notify();

    if (durationMs > 0) {
      this.transientTimer = setTimeout(() => {
        this.clearTransient();
      }, durationMs);
    }
  }

  clearTransient() {
    if (this.transientTimer) {
      clearTimeout(this.transientTimer);
      this.transientTimer = null;
    }
    if (this.transientState) {
      this.transientState = null;
      this._notify();
    }
  }

  // Interaction handlers
  handlePointerDown() {
    this.triggerTransient("pressed");
  }

  handlePointerUp() {
    // Release spring animation: 560ms duration, then smoothly back to persistent state
    this.triggerTransient("release", 560);
  }

  handlePetting() {
    const now = Date.now();
    if (now - this.lastPettingTime < this.pettingCooldownMs) {
      return false; // Cooldown active, don't spam petting
    }
    this.lastPettingTime = now;
    // Petting animation: 1600ms
    this.triggerTransient("petting", 1600);
    return true;
  }

  handleTurnSuccess() {
    if (this.persistentState === "thinking" || this.transientState === "pressed") return;
    // Single bounce: 720ms
    this.triggerTransient("success", 720);
  }

  destroy() {
    if (this.transientTimer) {
      clearTimeout(this.transientTimer);
      this.transientTimer = null;
    }
    this.listeners.clear();
  }
}

module.exports = {
  WidgetStateMachine,
  VALID_PERSISTENT_STATES,
  VALID_TRANSIENT_STATES
};
