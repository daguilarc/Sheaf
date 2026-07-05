#pragma once

// synth_runtime::ControllersPage — the Controllers page hosted by MainPane's
// content host (Plan 4 Task 4). A thin JUCE renderer over the JUCE-free
// synth::MidiConfigViewModel (include/synth/MidiConfigViewModel.hpp): this
// component owns NO tree/edit logic of its own -- every expand/collapse
// decision, row list, field-validity check, and slot-validity check lives in
// the view model (or, for slot validity, in synth::SlotValidForKind via the
// view model's ApplyMappingEdit/AddController). This component's only job is
// to paint the view model's current Controllers() tree and translate JUCE
// input events into VM calls, then commit successful edits through
// engine.EditInstrument (p4-globals.md binding: "edits commit via
// engine.EditInstrument + reconcile; UI can never produce an invalid slot").
//
// Structure: a Back button at the top (binding, p4-globals.md), then an outer
// juce::Viewport (binding: "scrollable in a juce::Viewport") whose content
// component (Content, a private nested class) lays out one ControllerRow per
// synth::MidiControllerRowVM, each with its own inner juce::Viewport for the
// mapping list when a section is expanded (mapping lists must themselves live
// inside a Viewport per the binding), followed by an "add controller" row.
// The whole content component is sized to fit its rows (kRowHeight *
// visible row count etc.) so the outer Viewport's scrollbar reflects the
// actual content height.
//
// Edit commit path (Task 4 brief step 2): every VM edit call
// (ApplyMappingEdit/AddController/SetEndpointRef) that returns true hands
// back a fully-edited MidiInstrumentConfig `out`; this page commits it via
// engine.EditInstrument([&](auto& inst){ inst = out; }), which triggers the
// engine's own MIDI-processor rebuild + rebuilt-callback (already wired, by
// Runtime, to midiConnections_->OnInstrumentRebuilt(), which resizes and
// reconciles -- Plan 3). A refusal (false return) never touches the engine;
// this page shows the VM's `reason` string in statusLabel_ and reverts the
// offending editor's displayed text instead (binding: "UI can never produce
// an invalid slot -- refusals shown in a status label").
//
// Device-ref commit path (Task 4 review, Important finding 3): ALL device
// combo changes -- selecting an enumerated (currently-present) device,
// clearing to "(none)", or re-selecting the synthetic "keep configured
// (offline)" entry -- go through the SAME VM SetEndpointRef -> EditInstrument
// commit path every other edit on this page uses. There is no direct
// MidiConnectionManager::ManualOpenInput/ManualOpenOutput call from this
// page: writing the chosen ref (or an empty MidiEndpointRef{} for "(none)")
// via SetEndpointRef and committing it through engine.EditInstrument is
// exactly the specced "device choice triggers reconciliation" semantics --
// the rebuilt callback + reconcile pass (Plan 3) then opens/closes the
// device itself, self-healing exactly like a persisted runtime-config endpoint
// ref would be picked up on load. This also means an endpoint that was Online
// and gets cleared to "(none)" is actually closed: PlanMidiReconciliation
// treats a now-unconfigured ref whose connection is still Online as a
// Close*+Mark*Offline case (see MidiReconcile.hpp's doc comment and
// reconcile_tests.cpp's unconfigured_ref_*_online_closes_and_marks_offline
// cases -- this was a planner gap fixed alongside this finding). The
// synthetic "keep configured (offline)" entry alone stays a true no-op (see
// OnDeviceSelected below): its ref is already what it was, so there is
// nothing to commit.
//
// Refresh discipline (Task 4 brief step 4): RefreshOnTick() rebuilds the VM
// from engine.InstrumentSnapshot() + connectionManager.State() only when
// dirty_ is set. dirty_ starts true (first tick must build the initial
// tree) and is set again by (a) runtime_.SetMidiProcessorsRebuiltHook()'s
// callback (installed in the constructor -- see Runtime.hpp's doc comment on
// that method), which fires on EVERY MIDI-processor rebuild regardless of
// cause (this page's own Commit(), runtime config loading, or any other
// engine-driven instrument edit -- Task 4 review, Critical finding 1: this
// closes the gap where an out-of-band instrument change was missed) and (b)
// a per-tick comparison against a cheap MidiConnectionManager state change
// counter is unnecessary here -- MidiConnectionManager has no such counter,
// so this page instead treats "connection state may have changed" the same
// as every other page's per-tick refresh (AudioConfigPage/FilePage both
// unconditionally re-read their own status every tick): it re-derives a
// lightweight fingerprint (controller count + each slot's input/output
// status) once per tick and only calls vm_.Rebuild() when that fingerprint
// or the rebuilt-hook's dirty flag differs from last tick. This is the
// "cheap change counter" the brief allows ("add a cheap change counter if
// needed"). Rebuild() is skipped entirely whenever any editor row currently
// has keyboard focus (editorFocusGuard_), so in-progress typing is never
// clobbered -- see HasFocusedEditor().
//
// Focus-safe refresh (Task 4 review, Important finding 5 -- "focus
// starvation"): a focus guard that blocks ALL rebuilds while ANY editor has
// focus is only safe if a pending rebuild is guaranteed to land promptly
// once focus is released, rather than staying blocked indefinitely because
// the user "finished editing" a field without literally clicking away from
// it:
//   (a) NumericFieldEditor::textEditorReturnKeyPressed commits AND calls
//       giveAwayKeyboardFocus() (see that method's doc comment) -- Return is
//       the field's "I'm done" gesture, and a JUCE TextEditor does not lose
//       keyboard focus from Return alone, so without this the page could
//       stay starved as long as the caret sits in that field.
//   (b) dirty_ stays latched (not cleared) whenever RefreshOnTick() skips a
//       rebuild for focus (see the early `return` in the focus-guard branch,
//       above dirty_'s only clearing assignment) -- the very next tick that
//       finds no editor focused performs the deferred rebuild. No separate
//       "pending" flag is needed; dirty_ itself already serves that role.
//   (c) Status/connection dots are NOT refreshed independently of a full VM
//       rebuild while a field elsewhere has focus: ControllerRow's status
//       dots are painted from inputStatus_/outputStatus_, snapshotted once
//       at ControllerRow construction time (RebuildRows()) rather than read
//       live in paint() -- splitting "just the dots" out from the row's
//       construction would mean duplicating (or restructuring) the row's
//       state ownership for a cosmetic latency improvement on a background
//       reconcile pass, which is not "trivially separable" per the brief's
//       own carve-out. Documenting this instead: a status dot's flip during
//       an in-progress edit elsewhere on the page is visible as soon as that
//       edit commits or focus otherwise moves away (a) -- the same
//       "refresh waits for focus loss" contract every other dirty-triggered
//       change on this page already has.

#include "synth/AppConcepts.hpp"
#include "synth/Engine.hpp"
#include "synth/MidiConfigViewModel.hpp"
#include "synth/MidiController.hpp"
#include "synth/MidiReconcile.hpp"

#include "MidiConnectionManager.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <cmath>
#include <cstddef>
#include <functional>
#include <memory>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace synth_runtime {

template <synth::SynthApplication App>
class Runtime;

template <synth::SynthApplication App>
class ControllersPage : public juce::Component {
public:
    explicit ControllersPage(Runtime<App>& runtime) : runtime_(runtime), content_(*this) {
        backButton_.setButtonText("Back");
        backButton_.onClick = [this] {
            if (onBack) {
                onBack();
            }
        };
        addAndMakeVisible(backButton_);

        statusLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
        statusLabel_.setJustificationType(juce::Justification::centredLeft);
        statusLabel_.setText("Ready", juce::dontSendNotification);
        addAndMakeVisible(statusLabel_);

        viewport_.setViewedComponent(&content_, false);
        viewport_.setScrollBarsShown(true, false);
        addAndMakeVisible(viewport_);

        // Subscribe to EVERY MIDI-processor rebuild (Task 4 review, Critical
        // finding 1) -- not just this page's own edits. Runtime config loading
        // (or any other engine-driven path) that changes controller
        // mappings/names/kinds also rebuilds MIDI processors and fires this
        // hook; without it, RefreshOnTick()'s dirty flag only ever tracked
        // this page's own Commit() calls plus a connection-status
        // fingerprint, so an out-of-band instrument change was silently
        // missed and a later edit from this page could commit on top of a
        // stale snapshot. Idempotent with Commit()'s own `dirty_ = true` --
        // see SetMidiProcessorsRebuiltHook's doc comment in Runtime.hpp for
        // the re-entrancy note (this page's own commits also fire this hook,
        // harmlessly). Cleared in the destructor, mirroring
        // AudioConfigPage's SetAudioStatusHook/SetAudioSyncHook teardown.
        runtime_.SetMidiProcessorsRebuiltHook([this] { dirty_ = true; });

        dirty_ = true;
        RefreshOnTick();
    }

    ControllersPage(const ControllersPage&) = delete;
    ControllersPage& operator=(const ControllersPage&) = delete;

    ~ControllersPage() override { runtime_.SetMidiProcessorsRebuiltHook({}); }

    void resized() override {
        auto area = getLocalBounds().reduced(4);
        auto backRow = area.removeFromTop(32);
        backButton_.setBounds(backRow.removeFromLeft(80));
        area.removeFromTop(4);

        statusLabel_.setBounds(area.removeFromBottom(24));
        area.removeFromBottom(4);

        viewport_.setBounds(area);
        content_.setSize(area.getWidth() - viewport_.getScrollBarThickness(), content_.PreferredHeight());
    }

    // Called once per UI timer tick by MainPane (mirrors AudioConfigPage's/
    // FilePage's own per-tick refresh). Rebuilds the VM from
    // engine.InstrumentSnapshot() + connectionManager.State() only when
    // dirty_ is set (an instrument edit landed, or the cheap per-tick
    // fingerprint below detected a connection-state change) -- see the class
    // doc comment's "Refresh discipline" paragraph. Skips the rebuild
    // entirely while any row editor has keyboard focus, so in-progress
    // typing/selection survives a refresh triggered by, say, a background
    // reconcile pass changing another controller's status dot.
    void RefreshOnTick() {
        const std::string fingerprint = ConnectionFingerprint();
        if (fingerprint != lastFingerprint_) {
            dirty_ = true;
            lastFingerprint_ = fingerprint;
        }

        if (!dirty_) {
            return;
        }
        if (content_.HasFocusedEditor()) {
            // Leave dirty_ set: a real change is still pending display, but
            // this tick must not disturb whatever the user is mid-typing.
            // The next tick where nothing has focus will pick it up.
            return;
        }

        vm_.Rebuild(runtime_.GetEngine().InstrumentSnapshot(), runtime_.MidiConnections().State());
        dirty_ = false;
        content_.RebuildRows();
        resized();
    }

    // Back control at the top of the page (binding, p4-globals.md): wired by
    // MainPane to ShowPage(Page::None), returning to the app.
    std::function<void()> onBack;

private:
    friend class Content;

    // Commits `out` via engine.EditInstrument -- the single path every
    // successful VM edit funnels through (class doc comment's "Edit commit
    // path"). The engine's own rebuilt-callback (wired by Runtime to
    // midiConnections_->OnInstrumentRebuilt()) handles the MIDI-processor
    // rebuild + reconcile; this page just marks itself dirty so the next
    // tick re-derives the VM from the freshly committed state.
    void Commit(synth::MidiInstrumentConfig out) {
        runtime_.GetEngine().EditInstrument([&](synth::MidiInstrumentConfig& inst) { inst = std::move(out); });
        dirty_ = true;
    }

    void SetStatus(const juce::String& text) { statusLabel_.setText(text, juce::dontSendNotification); }

    // Cheap per-tick fingerprint of "things that can change without this
    // page's own controls" -- controller count plus every slot's
    // input/output status, concatenated. Good enough to detect a background
    // reconcile pass (device plugged/unplugged, poll-driven resync) flipping
    // a status dot without requiring MidiConnectionManager to grow a change
    // counter of its own (class doc comment: "the cheap change counter the
    // brief allows"). Does not attempt to detect every possible instrument
    // mutation -- edits originating from THIS page already set dirty_
    // directly via Commit(), so this fingerprint only needs to catch
    // out-of-band connection-state changes.
    std::string ConnectionFingerprint() const {
        const synth::MidiConnectionState& state = runtime_.MidiConnections().State();
        std::string fp;
        fp.reserve(state.controllers.size() * 2 + 8);
        fp += std::to_string(state.controllers.size());
        for (const auto& controller : state.controllers) {
            fp += ':';
            fp += std::to_string(static_cast<int>(controller.input.status));
            fp += ',';
            fp += std::to_string(static_cast<int>(controller.output.status));
        }
        return fp;
    }

    // ---- Nested renderer components -------------------------------------

    // Formats `value` for display: integer fields (issue #9 -- Channel, Cc,
    // SlotIx, Position, GestureIx, LaunchpadX/Y, WrldBldrX/Y, SceneBlend)
    // render with no decimal places ("3", not "3.0000"); every other numeric
    // field (currently only TurnStep) keeps the prior 4-decimal display.
    static juce::String FormatFieldValue(synth::MidiMappingRowVM::Field field, double value) {
        if (synth::FieldIsInteger(field)) {
            return juce::String(static_cast<juce::int64>(std::llround(value)));
        }
        return juce::String(value, 4);
    }

    // Reviewer finding 3: the single source of truth for how wide ONE
    // editable field's control is, in row-layout units (kBaseEditorWidth ==
    // the width MappingRow::resized()/RowGroupHeader::resized()/
    // RequiredRowWidth() all previously hardcoded as a separate local
    // `kEditorWidth` constant, one copy per site). PressMessage/
    // ReleaseMessage/RelativeMode/BlockMessageType each render as a wide
    // combo box (SystemMessageFieldEditor/RelativeModeFieldEditor/
    // BlockMessageTypeFieldEditor -- see MappingRow's constructor) and need
    // double width; every other field (a NumericFieldEditor or a
    // BlockToggleFieldEditor) is single-width. Used by BOTH the row's own
    // editor layout (MappingRow::resized()) and the header's column-label
    // layout (RowGroupHeader::resized()), plus the width budget
    // (SectionBody::RequiredRowWidth()) that sizes the section's scrollable
    // content to fit -- before this fix, RowGroupHeader laid out every
    // column label at the single-width regardless of field, so a header run
    // that included Field::BlockMessageType (a double-width row editor)
    // rendered its OWN label too narrow and shifted every later header label
    // in that run out of alignment with the row below it.
    static constexpr int kBaseEditorWidth = 90;
    static int FieldEditorWidth(synth::MidiMappingRowVM::Field field) {
        using Field = synth::MidiMappingRowVM::Field;
        switch (field) {
            case Field::PressMessage:
            case Field::ReleaseMessage:
            case Field::RelativeMode:
            case Field::BlockMessageType:
                return 2 * kBaseEditorWidth;
            default:
                return kBaseEditorWidth;
        }
    }

    // One editable numeric field (juce::TextEditor) bound to a single
    // (controllerIx, section, rowIx, Field) edit target. Commits on
    // focus-loss/return (binding, p4-globals.md), never per keystroke.
    class NumericFieldEditor : public juce::TextEditor, private juce::TextEditor::Listener {
    public:
        NumericFieldEditor(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                           std::size_t rowIx, synth::MidiMappingRowVM::Field field, double initialValue)
            : page_(page), controllerIx_(controllerIx), section_(section), rowIx_(rowIx), field_(field) {
            setText(FormatFieldValue(field_, initialValue), juce::dontSendNotification);
            setSelectAllWhenFocused(true);
            addListener(this);
        }

        ~NumericFieldEditor() override { removeListener(this); }

    private:
        void textEditorFocusLost(juce::TextEditor&) override { Commit(); }

        // Task 4 review, Important finding 5 ("focus starvation"):
        // RefreshOnTick()'s focus guard (HasFocusedEditor()) blocks ALL VM
        // rebuilds while any editor on this page has keyboard focus, so a
        // pending dirty rebuild (e.g. another controller's status dot
        // flipping, or -- post finding 1 -- an out-of-band instrument
        // change) never lands while the user is mid-edit. A JUCE TextEditor
        // does NOT lose keyboard focus merely because Return was pressed --
        // textEditorFocusLost() only fires from an actual focus change
        // (click elsewhere, Tab, etc.) -- so committing on Return without
        // ALSO releasing focus would starve the page indefinitely whenever
        // the user presses Return and then simply leaves the caret there
        // (the common case: Return is the "I'm done editing this field"
        // gesture). giveAwayKeyboardFocus() releases focus to no component
        // in particular, so the pending dirty rebuild runs on the very next
        // tick that finds no editor focused -- see RefreshOnTick()'s doc
        // comment. This does asynchronously post a second focusLost-driven
        // Commit() for this same field (JUCE's focusLost() dispatches
        // textEditorFocusLost via an async command message, not
        // synchronously here) -- harmless, since re-committing the same
        // already-applied value is idempotent (ApplyMappingEdit has no
        // "changed since" gate, only a "still valid" one).
        void textEditorReturnKeyPressed(juce::TextEditor&) override {
            Commit();
            giveAwayKeyboardFocus();
        }

        void Commit() {
            const double value = getText().getDoubleValue();
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.ApplyMappingEdit(controllerIx_, section_, rowIx_, field_, value, out, &reason)) {
                page_.SetStatus("OK");
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                // Revert the editor text to the VM's last-known value for
                // this field (binding: "UI can never produce an invalid
                // slot" -- the displayed text must not silently keep an
                // edit the model rejected). RebuildRows() (triggered on the
                // next non-focused tick) will also re-derive this from the
                // VM, but reverting immediately avoids showing a rejected
                // value even for the remainder of this focus session.
                double reverted = 0.0;
                page_.vm_.RowFieldValue(controllerIx_, section_, rowIx_, field_, reverted);
                setText(FormatFieldValue(field_, reverted), juce::dontSendNotification);
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        synth::MidiConfigSection section_;
        std::size_t rowIx_;
        synth::MidiMappingRowVM::Field field_;
    };

    // A ComboBox over SystemMessageCatalog() labels for a single
    // PressMessage/ReleaseMessage field. Commits immediately on selection
    // (JUCE combo boxes have no separate "focus loss" edit concept the way
    // a text editor does -- selection IS the commit gesture here, matching
    // every other combo on this page and on AudioConfigPage/FilePage).
    class SystemMessageFieldEditor : public juce::ComboBox {
    public:
        SystemMessageFieldEditor(ControllersPage& page, std::size_t controllerIx, std::size_t rowIx,
                                 synth::MidiMappingRowVM::Field field)
            : page_(page), controllerIx_(controllerIx), rowIx_(rowIx), field_(field) {
            const auto& catalog = synth::SystemMessageCatalog();
            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix) {
                // "None" (catalog index 0) is only a legal choice for
                // ReleaseMessage (the VM refuses it for PressMessage) -- omit
                // it from the Press combo entirely so the UI can never even
                // select an invalid choice, rather than relying solely on
                // the refusal path.
                if (ix == 0 && field_ == synth::MidiMappingRowVM::Field::PressMessage) {
                    continue;
                }
                addItem(juce::String(catalog[ix].label), ix + 1);
            }
            const int current = page_.vm_.SystemMessageChoiceIndex(controllerIx_, synth::MidiConfigSection::SystemMessages,
                                                                    rowIx_, field_);
            if (current >= 0) {
                setSelectedId(current + 1, juce::dontSendNotification);
            }
            onChange = [this] { Commit(); };
        }

    private:
        void Commit() {
            const int choiceIx = getSelectedId() - 1;
            if (choiceIx < 0) {
                return;
            }
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.ApplyMappingEdit(controllerIx_, synth::MidiConfigSection::SystemMessages, rowIx_, field_,
                                           static_cast<double>(choiceIx), out, &reason)) {
                page_.SetStatus("OK");
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                const int current = page_.vm_.SystemMessageChoiceIndex(
                    controllerIx_, synth::MidiConfigSection::SystemMessages, rowIx_, field_);
                setSelectedId(current >= 0 ? current + 1 : 0, juce::dontSendNotification);
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        std::size_t rowIx_;
        synth::MidiMappingRowVM::Field field_;
    };

    // A ComboBox over RelativeModeCatalog() for the Encoders section's
    // Field::RelativeMode pseudo-row (issue #9 -- Mode is a dropdown, not a
    // numeric editor). Selection index maps 1:1 to a RelativeModeCatalog()
    // index (item ids are 1-based, catalog indices 0-based, same convention
    // SystemMessageFieldEditor uses above). Commits immediately on
    // selection, same as SystemMessageFieldEditor.
    class RelativeModeFieldEditor : public juce::ComboBox {
    public:
        RelativeModeFieldEditor(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                                std::size_t rowIx)
            : page_(page), controllerIx_(controllerIx), section_(section), rowIx_(rowIx) {
            const auto& catalog = synth::RelativeModeCatalog();
            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix) {
                addItem(juce::String(catalog[ix]), ix + 1);
            }
            double current = 0.0;
            if (page_.vm_.RowFieldValue(controllerIx_, section_, rowIx_, synth::MidiMappingRowVM::Field::RelativeMode,
                                        current)) {
                setSelectedId(static_cast<int>(current) + 1, juce::dontSendNotification);
            }
            onChange = [this] { Commit(); };
        }

    private:
        void Commit() {
            const int choiceIx = getSelectedId() - 1;
            if (choiceIx < 0) {
                return;
            }
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.ApplyMappingEdit(controllerIx_, section_, rowIx_, synth::MidiMappingRowVM::Field::RelativeMode,
                                           static_cast<double>(choiceIx), out, &reason)) {
                page_.SetStatus("OK");
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                double current = 0.0;
                if (page_.vm_.RowFieldValue(controllerIx_, section_, rowIx_,
                                            synth::MidiMappingRowVM::Field::RelativeMode, current)) {
                    setSelectedId(static_cast<int>(current) + 1, juce::dontSendNotification);
                }
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        synth::MidiConfigSection section_;
        std::size_t rowIx_;
    };

    // A ComboBox over BlockableMessageCatalog() for a system Block row's
    // Field::BlockMessageType (D6: "message type as a 3-choice combo of
    // blockable types"). Mirrors RelativeModeFieldEditor's index convention
    // (item ids 1-based, catalog indices 0-based), but reads its initial/
    // reverted selection via the dedicated MidiConfigViewModel::
    // BlockMessageTypeIndex() rather than RowFieldValue() -- RowFieldValue()
    // deliberately refuses this field (a message type is not a single
    // numeric value), the same reason PressMessage/ReleaseMessage use
    // SystemMessageChoiceIndex() instead. Only ever constructed for
    // MidiConfigSection::SystemMessages rows (the only section with system
    // Block rows), so the section argument SystemMessageFieldEditor takes is
    // hardcoded rather than threaded through.
    class BlockMessageTypeFieldEditor : public juce::ComboBox {
    public:
        BlockMessageTypeFieldEditor(ControllersPage& page, std::size_t controllerIx, std::size_t rowIx)
            : page_(page), controllerIx_(controllerIx), rowIx_(rowIx) {
            const auto& catalog = synth::BlockableMessageCatalog();
            for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix) {
                addItem(juce::String(catalog[ix]), ix + 1);
            }
            const int current =
                page_.vm_.BlockMessageTypeIndex(controllerIx_, synth::MidiConfigSection::SystemMessages, rowIx_);
            if (current >= 0) {
                setSelectedId(current + 1, juce::dontSendNotification);
            }
            onChange = [this] { Commit(); };
        }

    private:
        void Commit() {
            const int choiceIx = getSelectedId() - 1;
            if (choiceIx < 0) {
                return;
            }
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.ApplyMappingEdit(controllerIx_, synth::MidiConfigSection::SystemMessages, rowIx_,
                                           synth::MidiMappingRowVM::Field::BlockMessageType,
                                           static_cast<double>(choiceIx), out, &reason)) {
                page_.SetStatus("OK");
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                const int current = page_.vm_.BlockMessageTypeIndex(controllerIx_,
                                                                     synth::MidiConfigSection::SystemMessages, rowIx_);
                setSelectedId(current >= 0 ? current + 1 : 0, juce::dontSendNotification);
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        std::size_t rowIx_;
    };

    // A ToggleButton for a 0/1 block field (Field::BlockRowMajor /
    // Field::BlockOutputFeedback -- D6: "row-major as a toggle"). Commits
    // immediately on click, same "selection is the commit gesture" contract
    // SystemMessageFieldEditor/RelativeModeFieldEditor use for their combos.
    class BlockToggleFieldEditor : public juce::ToggleButton {
    public:
        BlockToggleFieldEditor(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                               std::size_t rowIx, synth::MidiMappingRowVM::Field field)
            : page_(page), controllerIx_(controllerIx), section_(section), rowIx_(rowIx), field_(field) {
            setButtonText(synth::FieldShortLabel(field_));
            double current = 0.0;
            if (page_.vm_.RowFieldValue(controllerIx_, section_, rowIx_, field_, current)) {
                setToggleState(current != 0.0, juce::dontSendNotification);
            }
            onClick = [this] { Commit(); };
        }

    private:
        void Commit() {
            synth::MidiInstrumentConfig out;
            std::string reason;
            const double value = getToggleState() ? 1.0 : 0.0;
            if (page_.vm_.ApplyMappingEdit(controllerIx_, section_, rowIx_, field_, value, out, &reason)) {
                page_.SetStatus("OK");
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                double current = 0.0;
                if (page_.vm_.RowFieldValue(controllerIx_, section_, rowIx_, field_, current)) {
                    setToggleState(current != 0.0, juce::dontSendNotification);
                }
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        synth::MidiConfigSection section_;
        std::size_t rowIx_;
        synth::MidiMappingRowVM::Field field_;
    };

    // One mapping-list row: editors for its editableFields, laid out from the
    // left edge. The row used to also render a left-hand prose label
    // (`rowVm.label`, e.g. "turn ch0 cc12 -> slot 0 pos 3") duplicating
    // information RowGroupHeader already conveys via its per-group caption
    // (Turn/Push/Mode/.../System) plus its column labels (Ch/CC/Slot/Pos/...
    // via FieldShortLabel) -- removed as redundant (label-launchpad-brief.md
    // Change 1). `rowVm.label` itself is left in MidiMappingRowVM (harmless,
    // still used elsewhere) -- only the rendering of it is gone.
    class MappingRow : public juce::Component {
    public:
        static constexpr int kHeight = 28;

        MappingRow(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                  std::size_t rowIx, const synth::MidiMappingRowVM& rowVm) {
            // Reviewer finding 1: editors are laid out (resized(), below) in
            // this SAME editableFields order via orderedEditors_, not bucketed
            // by editor kind -- RowGroupHeader's column labels already follow
            // editableFields order (see RowGroupHeader's constructor), so a
            // row whose editableFields doesn't happen to sort all-numerics-
            // then-combo-then-toggles (e.g. SystemBlockEditableFields() puts
            // BlockMessageType first, then Channel/BlockStartCc/BlockEndCc,
            // then BlockOutputFeedback last, or the wrldbldr/launchpad 2-D
            // form which puts BlockRowMajor before the trailing
            // BlockStartArg/BlockOutputFeedback fields) previously had its
            // controls laid out in bucket order (all numerics, then the combo,
            // then toggles) while the header above it laid out labels in
            // editableFields order -- misaligning every column after the
            // first field whose bucket differs from its position. Walking the
            // same editableFields sequence for both header and row makes
            // alignment structural rather than coincidental.
            for (const synth::MidiMappingRowVM::Field field : rowVm.editableFields) {
                if (field == synth::MidiMappingRowVM::Field::PressMessage ||
                    field == synth::MidiMappingRowVM::Field::ReleaseMessage) {
                    auto editor = std::make_unique<SystemMessageFieldEditor>(page, controllerIx, rowIx, field);
                    addAndMakeVisible(*editor);
                    orderedEditors_.emplace_back(field, editor.get());
                    systemMessageEditors_.push_back(std::move(editor));
                } else if (field == synth::MidiMappingRowVM::Field::RelativeMode) {
                    // Issue #9: Mode is a dropdown over RelativeModeCatalog(),
                    // not a numeric editor.
                    auto editor = std::make_unique<RelativeModeFieldEditor>(page, controllerIx, section, rowIx);
                    addAndMakeVisible(*editor);
                    orderedEditors_.emplace_back(field, editor.get());
                    relativeModeEditors_.push_back(std::move(editor));
                } else if (field == synth::MidiMappingRowVM::Field::BlockMessageType) {
                    // D6: message type as a 3-choice combo of blockable
                    // types, over BlockableMessageCatalog() -- task group 3
                    // replaces task group 2's "skip this field entirely"
                    // interim behaviour (see BlockMessageTypeFieldEditor's
                    // doc comment for why it reads its value via the
                    // dedicated BlockMessageTypeIndex() rather than
                    // RowFieldValue()).
                    auto editor = std::make_unique<BlockMessageTypeFieldEditor>(page, controllerIx, rowIx);
                    addAndMakeVisible(*editor);
                    orderedEditors_.emplace_back(field, editor.get());
                    blockMessageTypeEditors_.push_back(std::move(editor));
                } else if (field == synth::MidiMappingRowVM::Field::BlockRowMajor ||
                          field == synth::MidiMappingRowVM::Field::BlockOutputFeedback) {
                    // D6: row-major (and output-feedback) as a 0/1 toggle.
                    auto editor = std::make_unique<BlockToggleFieldEditor>(page, controllerIx, section, rowIx, field);
                    addAndMakeVisible(*editor);
                    orderedEditors_.emplace_back(field, editor.get());
                    toggleEditors_.push_back(std::move(editor));
                } else {
                    // A system row's Channel/Cc/LaunchpadX/Y/WrldBldrX/Y/
                    // Button CAN theoretically still fail RowFieldValue if a
                    // hand-edited/corrupted patch JSON loaded an association
                    // missing its kind-required address (PatchPersistence's
                    // FromJSON treats control/wrldBldrPosition/
                    // launchpadPosition as optional on parse, unlike
                    // SlotValidForKind, which ApplyMappingEdit enforces on
                    // every COMMIT but load does not enforce on READ) --
                    // skipping the editor for that malformed case is the
                    // safe outcome (not editable is strictly better than
                    // silently-0-and-committable), and no normal UI-driven
                    // edit can ever produce it in the first place (finding 4,
                    // task group 2 review).
                    double initial = 0.0;
                    if (!page.vm_.RowFieldValue(controllerIx, section, rowIx, field, initial)) {
                        continue;
                    }
                    auto editor =
                        std::make_unique<NumericFieldEditor>(page, controllerIx, section, rowIx, field, initial);
                    addAndMakeVisible(*editor);
                    orderedEditors_.emplace_back(field, editor.get());
                    numericEditors_.push_back(std::move(editor));
                }
            }

            if (rowVm.deletable) {
                deleteButton_ = std::make_unique<juce::TextButton>("x");
                deleteButton_->onClick = [&page, controllerIx, section, rowIx] {
                    // DeleteRow's commit rebuilds the presentation (a row
                    // vanishes), which in turn triggers Content::RebuildRows()
                    // -- destroying this MappingRow and the very button mid-
                    // click. Same self-destruction hazard as the disclosure/
                    // section-toggle buttons below (ControllerRow), same
                    // deferred-callAsync-with-SafePointer fix.
                    juce::Component::SafePointer<ControllersPage> safePage(&page);
                    juce::MessageManager::callAsync([safePage, controllerIx, section, rowIx] {
                        if (safePage == nullptr) {
                            return;
                        }
                        synth::MidiInstrumentConfig out;
                        std::string reason;
                        if (safePage->vm_.DeleteRow(controllerIx, section, rowIx, out, &reason)) {
                            safePage->SetStatus("Deleted");
                            safePage->Commit(std::move(out));
                        } else {
                            safePage->SetStatus(juce::String("Refused: ") + juce::String(reason));
                        }
                    });
                };
                addAndMakeVisible(*deleteButton_);
            }
        }

        // Walks orderedEditors_ (every editor this row constructed, in
        // editableFields order) rather than the per-kind vectors below --
        // this is what makes "covers all editors" structural: a field kind
        // added to the else-if chain in the constructor above without a
        // matching push_back onto orderedEditors_ simply wouldn't compile
        // (emplace_back happens right next to every addAndMakeVisible), so
        // there's no separate list here that can silently fall out of sync
        // with the constructor the way the old per-kind HasFocusedEditor()
        // loops could (and did -- toggleEditors_/BlockToggleFieldEditor was
        // never checked here pre-fix, so a focused row-major/output-feedback
        // toggle didn't block RefreshOnTick()'s rebuild).
        // juce::ToggleButton has no text caret, so hasKeyboardFocus(true)
        // (self-or-child) is the right check for it same as the combo boxes;
        // it's also a safe superset for the TextEditor/NumericFieldEditor
        // case (no focusable children there), so a single uniform call
        // works for every editor kind in the row.
        bool HasFocusedEditor() const {
            for (const auto& entry : orderedEditors_) {
                if (entry.second->hasKeyboardFocus(true)) {
                    return true;
                }
            }
            return false;
        }

        void resized() override {
            auto area = getLocalBounds();
            static constexpr int kDeleteButtonWidth = 22;
            if (deleteButton_) {
                deleteButton_->setBounds(area.removeFromRight(kDeleteButtonWidth).reduced(2));
            }
            // Fields now start at the left edge (label-launchpad-brief.md
            // Change 1 removed the per-row prose label that used to be
            // reserved here via area.removeFromLeft(...)); RowGroupHeader's
            // column-label row (see its resized()) starts its own labels at
            // this SAME left origin (no caption-width reservation there
            // either, beyond the caption's own short line), so the two stay
            // aligned.
            // Reviewer finding 1: walk orderedEditors_ -- the SAME
            // editableFields-ordered sequence the constructor above built --
            // rather than bucketing by editor kind (all numerics, then the
            // combo, then toggles). RowGroupHeader::resized() lays out its
            // column labels in editableFields order too (see that method),
            // so walking the identical order here is what keeps a row's
            // controls under the header's labels for every editableFields
            // permutation, not just the ones where kind-bucket order happens
            // to match field order. Widths still come from the single shared
            // FieldEditorWidth() helper (reviewer finding 3) so this row's
            // editors and its RowGroupHeader's column labels can never
            // disagree on how wide a given field is.
            for (auto& [field, editor] : orderedEditors_) {
                editor->setBounds(area.removeFromLeft(FieldEditorWidth(field)).reduced(2));
            }
        }

    private:
        std::vector<std::unique_ptr<NumericFieldEditor>> numericEditors_;
        std::vector<std::unique_ptr<SystemMessageFieldEditor>> systemMessageEditors_;
        std::vector<std::unique_ptr<RelativeModeFieldEditor>> relativeModeEditors_;
        std::vector<std::unique_ptr<BlockMessageTypeFieldEditor>> blockMessageTypeEditors_;
        std::vector<std::unique_ptr<BlockToggleFieldEditor>> toggleEditors_;
        // Every editor above, paired with its Field and in editableFields
        // construction order -- the single ordered collection resized() and
        // HasFocusedEditor() both walk (reviewer finding 1). The typed
        // vectors above remain the owners (unique_ptr); this holds
        // non-owning observer pointers only, so it must never outlive them
        // (it doesn't -- same object, same lifetime).
        std::vector<std::pair<synth::MidiMappingRowVM::Field, juce::Component*>> orderedEditors_;
        std::unique_ptr<juce::TextButton> deleteButton_;
    };

    // A thin divider + column-header row inserted above each contiguous run
    // of same-(RowGroup, editableFields) rows (issue #9 -- "each contiguous
    // group of same-schema rows gets a header row naming its columns";
    // issue #11 -- the scene-blend group additionally gets a distinct
    // caption so it reads as clearly separate from the gesture rows above
    // it, not just another row in the same list). Splitting on the FULL
    // editableFields vector (not just RowGroup/Kind) is reviewer finding 1's
    // fix: two rows can share the same (RowGroup, Kind) yet still disagree
    // on editableFields -- e.g. two System Block rows in the same group both
    // have Kind::Block, but a BankSelect block's SystemBlockEditableFields()
    // adds Field::BlockBankSlotIx that a SceneSelect/GestureSelect block in
    // the same run doesn't have (see SystemBlockEditableFields in
    // MidiConfigViewModel.cpp) -- splitting on Kind alone would keep both
    // under one header sized for the first row's fields, silently mislabeling
    // (or omitting a header cell for) the second row's extra column. A plain
    // RowGroup/Kind change (e.g. a WRLD.Bldr turn group that's one 16-cell
    // block plus a stray individual turn -- BlockStartCc/BlockEndCc/
    // BlockStartPos vs Cc/Position) still splits too, since editableFields
    // necessarily differs whenever Kind does -- see SectionBody's grouping
    // loop. Column labels come from FieldShortLabel() over the run's first
    // row's editableFields -- the single source of truth for both what a row
    // renders and what its header calls it, so the two can never drift
    // apart. Mode/Step/SceneBlend groups (which are not
    // tabular chan/cc/... rows) show a short caption instead of/beside
    // column labels.
    //
    // "+"/"+B" (D6, sru-11): shown only on the FIRST header of a RowGroup
    // within a section (SectionBody tracks this -- see its `seenGroups` set)
    // since AddSingle/AddBlock always append at the group's END regardless of
    // which contiguous run's header the user clicked; showing the buttons on
    // every sub-run header of the same group would suggest they insert at
    // that run's position, which they do not. `addSingle`/`addBlock` are
    // null when this RowGroupHeader is not that first-in-group header, or
    // (for addBlock) when the group/kind combination never supports blocks
    // (sru-11: "where blocks apply") -- e.g. MfTwister's System group (D4
    // point 3: "twister system messages never block").
    // Change 1 (label-launchpad-brief.md): now that MappingRow no longer
    // reserves a left-hand label column, this header's own column labels
    // start at the SAME left origin (x=0) the rows' editors now do -- but
    // the per-group caption (Turn/Push/Mode/Step/Gestures/Scene blend) must
    // stay visible too (every group must remain identifiable, brief Change
    // 1's own requirement), so it now sits on its own short line ABOVE the
    // column-label line rather than sharing a row with it at a reserved
    // left-hand width. kHeight grows accordingly (kCaptionHeight +
    // kColumnLabelHeight) to fit both lines.
    class RowGroupHeader : public juce::Component {
    public:
        static constexpr int kCaptionHeight = 14;
        static constexpr int kColumnLabelHeight = 18;
        static constexpr int kHeight = kCaptionHeight + kColumnLabelHeight + 2;  // +2 clears the divider rule

        RowGroupHeader(synth::MidiMappingRowVM::RowGroup group, const std::vector<synth::MidiMappingRowVM::Field>& fields,
                      std::function<void()> addSingle, std::function<void()> addBlock) {
            juce::String caption;
            switch (group) {
                case synth::MidiMappingRowVM::RowGroup::EncoderTurn:
                    caption = "Turn";
                    break;
                case synth::MidiMappingRowVM::RowGroup::EncoderPush:
                    caption = "Push";
                    break;
                case synth::MidiMappingRowVM::RowGroup::EncoderMode:
                    caption = "Mode";
                    break;
                case synth::MidiMappingRowVM::RowGroup::EncoderStep:
                    caption = "Step";
                    break;
                case synth::MidiMappingRowVM::RowGroup::AnalogGesture:
                    caption = "Gestures";
                    break;
                case synth::MidiMappingRowVM::RowGroup::AnalogSceneBlend:
                    caption = "Scene blend";
                    break;
                case synth::MidiMappingRowVM::RowGroup::System:
                    caption = "System";
                    break;
            }
            captionLabel_.setColour(juce::Label::textColourId, juce::Colours::lightgrey);
            captionLabel_.setFont(juce::Font(juce::FontOptions(13.0f, juce::Font::bold)));
            captionLabel_.setJustificationType(juce::Justification::centredLeft);
            captionLabel_.setText(caption, juce::dontSendNotification);
            addAndMakeVisible(captionLabel_);

            for (const synth::MidiMappingRowVM::Field field : fields) {
                if (field == synth::MidiMappingRowVM::Field::PressMessage ||
                    field == synth::MidiMappingRowVM::Field::ReleaseMessage ||
                    field == synth::MidiMappingRowVM::Field::RelativeMode) {
                    continue;  // wide combo columns aren't given a short header cell
                }
                auto label = std::make_unique<juce::Label>();
                label->setColour(juce::Label::textColourId, juce::Colours::grey);
                label->setFont(juce::Font(juce::FontOptions(12.0f)));
                label->setJustificationType(juce::Justification::centred);
                label->setText(synth::FieldShortLabel(field), juce::dontSendNotification);
                addAndMakeVisible(*label);
                columnLabels_.push_back(std::move(label));
                // Reviewer finding 3: BlockMessageType DOES get a header
                // cell here (unlike Press/Release/RelativeMode above, which
                // are skipped entirely) but renders as a double-width combo
                // in the row (MappingRow's blockMessageTypeEditors_) -- this
                // per-field width, read back in resized() below via
                // FieldEditorWidth(), is what keeps this cell (and every
                // later cell in the same header) aligned with the row under
                // it instead of assuming every column label is
                // kBaseEditorWidth wide.
                columnFieldWidths_.push_back(FieldEditorWidth(field));
            }

            if (addSingle) {
                addButton_ = std::make_unique<juce::TextButton>("+");
                addButton_->onClick = std::move(addSingle);
                addAndMakeVisible(*addButton_);
            }
            if (addBlock) {
                addBlockButton_ = std::make_unique<juce::TextButton>("+B");
                addBlockButton_->onClick = std::move(addBlock);
                addAndMakeVisible(*addBlockButton_);
            }
        }

        void paint(juce::Graphics& g) override {
            g.setColour(juce::Colours::darkgrey);
            g.fillRect(0, 0, getWidth(), 1);
        }

        void resized() override {
            auto area = getLocalBounds();
            area.removeFromTop(2);  // clears the divider rule painted at y=0
            // Caption on its own short line, full width, left-justified text
            // (Justification::centredLeft set in the constructor) -- no
            // left-hand width reservation for it, since it no longer shares
            // its line with the column labels.
            captionLabel_.setBounds(area.removeFromTop(kCaptionHeight));

            auto columnArea = area.removeFromTop(kColumnLabelHeight);
            static constexpr int kAddButtonWidth = 28;
            if (addBlockButton_) {
                addBlockButton_->setBounds(columnArea.removeFromRight(kAddButtonWidth).reduced(2));
            }
            if (addButton_) {
                addButton_->setBounds(columnArea.removeFromRight(kAddButtonWidth).reduced(2));
            }
            // Column labels start at the same left origin (x=0) MappingRow's
            // editors now start at (Change 1 removed both the row's label
            // column and this header's matching caption-width reservation).
            // Reviewer finding 3: each label's width comes from the SAME
            // per-field width (columnFieldWidths_, populated via
            // FieldEditorWidth() in the constructor above) that
            // MappingRow::resized() uses for that field's actual editor --
            // previously every header cell was hardcoded to the single-width
            // kEditorWidth even for a double-width field like
            // Field::BlockMessageType, shifting every later header label out
            // of alignment with the row beneath it.
            for (std::size_t ix = 0; ix < columnLabels_.size(); ++ix) {
                columnLabels_[ix]->setBounds(columnArea.removeFromLeft(columnFieldWidths_[ix]).reduced(2));
            }
        }

    private:
        juce::Label captionLabel_;
        std::vector<std::unique_ptr<juce::Label>> columnLabels_;
        std::vector<int> columnFieldWidths_;
        std::unique_ptr<juce::TextButton> addButton_;
        std::unique_ptr<juce::TextButton> addBlockButton_;
    };

    // A section's body: its own inner juce::Viewport over a stack of
    // MappingRows, with a RowGroupHeader (divider + column labels, plus
    // "+"/"+B" on the first header of each group) inserted wherever a row's
    // `group` OR its full `editableFields` differs from the previous row's
    // (issue #9's headers/dividers, issue #11's scene-blend separation, task
    // group 3's Block-run splitting, reviewer finding 1's editableFields-
    // vector comparison) -- see RowGroupHeader's doc comment (binding:
    // "Mapping lists live inside juce::Viewports"). Whether a group's "+"/
    // "+B" affordance is shown at all is answered by the VM
    // (GroupSupportsAdd/GroupSupportsBlocks, D6 "renderer stays thin; all
    // decisions from the view model" -- reviewer finding 2), not by any
    // page-local gate.
    class SectionBody : public juce::Component {
    public:
        static constexpr int kMaxVisibleHeight = 220;

        SectionBody(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section) {
            const std::vector<synth::MidiMappingRowVM> rows = page.vm_.SectionRows(controllerIx, section);

            int totalHeight = 0;
            int minContentWidth = 0;
            std::optional<synth::MidiMappingRowVM::RowGroup> previousGroup;
            std::optional<std::vector<synth::MidiMappingRowVM::Field>> previousFields;
            std::set<synth::MidiMappingRowVM::RowGroup> seenGroups;
            for (std::size_t rowIx = 0; rowIx < rows.size(); ++rowIx) {
                minContentWidth = juce::jmax(minContentWidth, RequiredRowWidth(rows[rowIx].editableFields));
                const synth::MidiMappingRowVM::RowGroup group = rows[rowIx].group;
                // Split on a RowGroup change OR a change in the FULL
                // editableFields sequence within the same group (reviewer
                // finding 1) -- schema-blind splitting on just (RowGroup,
                // Kind) mislabels e.g. a run of System Block rows where one
                // is a BankSelect block (editableFields includes
                // Field::BlockBankSlotIx) and another isn't, since both share
                // Kind::Block. Comparing the whole vector also still splits
                // on every Kind change (Individual/Block editableFields
                // shapes never coincide), so this subsumes the prior
                // Kind-based check. See RowGroupHeader's doc comment above.
                if (!previousGroup.has_value() || *previousGroup != group ||
                    *previousFields != rows[rowIx].editableFields) {
                    const bool isFirstHeaderForGroup = seenGroups.insert(group).second;
                    std::function<void()> addSingle;
                    std::function<void()> addBlock;
                    if (isFirstHeaderForGroup && page.vm_.GroupSupportsAdd(controllerIx, section, group)) {
                        addSingle = MakeAddCallback(page, controllerIx, section, group, /*asBlock=*/false);
                        if (page.vm_.GroupSupportsBlocks(controllerIx, section, group)) {
                            addBlock = MakeAddCallback(page, controllerIx, section, group, /*asBlock=*/true);
                        }
                    }
                    auto header = std::make_unique<RowGroupHeader>(group, rows[rowIx].editableFields,
                                                                    std::move(addSingle), std::move(addBlock));
                    rowsHost_.addAndMakeVisible(*header);
                    layout_.push_back({header.get(), RowGroupHeader::kHeight});
                    headers_.push_back(std::move(header));
                    totalHeight += RowGroupHeader::kHeight;
                    previousGroup = group;
                    previousFields = rows[rowIx].editableFields;
                }
                auto row = std::make_unique<MappingRow>(page, controllerIx, section, rowIx, rows[rowIx]);
                rowsHost_.addAndMakeVisible(*row);
                layout_.push_back({row.get(), MappingRow::kHeight});
                totalHeight += MappingRow::kHeight;
                rows_.push_back(std::move(row));
            }

            // sru-11 "empty group still offers add": the row walk above only
            // ever emits a RowGroupHeader alongside an existing row, so a
            // group with zero rows -- or a whole empty section, e.g. a
            // freshly-added generic controller -- would otherwise have no
            // header to hang "+"/"+B" off of. AddableGroups() (canonical
            // order already, per its own doc comment) is the VM's list of
            // every group this (controllerIx, section) could add into;
            // append a header-only RowGroupHeader (no MappingRow beneath)
            // for each one NOT already covered by a header from the walk
            // above (`seenGroups`), using GroupColumnFields() for its column
            // schema since there is no real row to read editableFields off
            // of. These always land after every real row/header (canonical
            // order still holds section-relative -- an empty group's natural
            // position, between two populated groups, would require
            // interleaving with the row walk above; simpler to append at the
            // section's end, per this fix's own brief: "empty-group add-
            // headers may sit at the section's end").
            for (const synth::MidiMappingRowVM::RowGroup group : page.vm_.AddableGroups(controllerIx, section)) {
                if (seenGroups.count(group) != 0) {
                    continue;
                }
                const std::vector<synth::MidiMappingRowVM::Field> columnFields =
                    page.vm_.GroupColumnFields(controllerIx, section, group);
                minContentWidth = juce::jmax(minContentWidth, RequiredRowWidth(columnFields));
                std::function<void()> addSingle = MakeAddCallback(page, controllerIx, section, group,
                                                                   /*asBlock=*/false);
                std::function<void()> addBlock;
                if (page.vm_.GroupSupportsBlocks(controllerIx, section, group)) {
                    addBlock = MakeAddCallback(page, controllerIx, section, group, /*asBlock=*/true);
                }
                auto header = std::make_unique<RowGroupHeader>(group, columnFields, std::move(addSingle),
                                                                std::move(addBlock));
                rowsHost_.addAndMakeVisible(*header);
                layout_.push_back({header.get(), RowGroupHeader::kHeight});
                headers_.push_back(std::move(header));
                totalHeight += RowGroupHeader::kHeight;
            }

            minContentWidth_ = minContentWidth;
            rowsHost_.setSize(juce::jmax(1, minContentWidth_), totalHeight);
            LayoutRows();

            viewport_.setViewedComponent(&rowsHost_, false);
            // Block rows can carry up to nine fields (e.g. a WRLD.Bldr
            // bank-select block: type + channel + 4 coords + arg + bank slot
            // + feedback) -- wider than the page's available horizontal
            // space at typical window sizes. Rather than clipping/squashing
            // those editors unreadably, enable the inner viewport's
            // horizontal scrollbar too (the outer page viewport stays
            // vertical-only, per the existing binding: only THIS section's
            // own mapping list needs to scroll sideways) and size rowsHost_
            // to each row's actual required width (see RequiredRowWidth) so
            // a narrow section's rows still fill the available width exactly
            // as before (resized() below re-clamps to
            // max(available, minContentWidth_) on every relayout).
            viewport_.setScrollBarsShown(true, true);
            addAndMakeVisible(viewport_);
        }

        bool HasFocusedEditor() const {
            for (const auto& row : rows_) {
                if (row->HasFocusedEditor()) {
                    return true;
                }
            }
            return false;
        }

        int PreferredHeight() const { return juce::jmin(kMaxVisibleHeight, rowsHost_.getHeight()); }

        void resized() override {
            viewport_.setBounds(getLocalBounds());
            const int available = getWidth() - viewport_.getScrollBarThickness();
            rowsHost_.setSize(juce::jmax(available, minContentWidth_), rowsHost_.getHeight());
            LayoutRows();
        }

    private:
        // The widest single-line width a row with these editableFields needs
        // (each editor's width, matching MappingRow::resized()'s own
        // per-field widths exactly so the two can never drift apart) -- the
        // basis for SectionBody's horizontal-overflow handling (see the
        // constructor's doc comment above): a block row's wide field set (up
        // to nine fields for a WRLD.Bldr bank-select block) gets the inner
        // viewport's own width, with the horizontal scrollbar picking up
        // whatever the page's available width can't show, rather than every
        // editor being squashed into an unreadable sliver. No more label-
        // column width here (Change 1 removed MappingRow's left-hand label
        // column entirely; fields now start at the row's left edge).
        static int RequiredRowWidth(const std::vector<synth::MidiMappingRowVM::Field>& fields) {
            constexpr int kDeleteButtonWidth = 22;
            int width = kDeleteButtonWidth;
            for (const synth::MidiMappingRowVM::Field field : fields) {
                // Reviewer finding 3: same FieldEditorWidth() helper
                // MappingRow::resized()/RowGroupHeader::resized() use, so
                // this width budget can never drift from what those two
                // actually lay out.
                width += FieldEditorWidth(field);
            }
            return width;
        }

        // Builds the deferred AddSingle/AddBlock click callback shared by
        // every RowGroupHeader's "+"/"+B" button: same self-destruction
        // hazard as the delete button (MappingRow) and the disclosure/
        // section-toggle buttons (ControllerRow) -- a successful Add*
        // commits, which rebuilds the presentation and, via
        // Content::RebuildRows(), destroys this SectionBody and the very
        // button mid-click. Deferred past the click via callAsync, guarded
        // with a SafePointer.
        static std::function<void()> MakeAddCallback(ControllersPage& page, std::size_t controllerIx,
                                                      synth::MidiConfigSection section,
                                                      synth::MidiMappingRowVM::RowGroup group, bool asBlock) {
            return [&page, controllerIx, section, group, asBlock] {
                juce::Component::SafePointer<ControllersPage> safePage(&page);
                juce::MessageManager::callAsync([safePage, controllerIx, section, group, asBlock] {
                    if (safePage == nullptr) {
                        return;
                    }
                    synth::MidiInstrumentConfig out;
                    std::string reason;
                    const bool ok = asBlock ? safePage->vm_.AddBlock(controllerIx, section, group, out, &reason)
                                            : safePage->vm_.AddSingle(controllerIx, section, group, out, &reason);
                    if (ok) {
                        safePage->SetStatus(asBlock ? "Added block" : "Added");
                        safePage->Commit(std::move(out));
                    } else {
                        safePage->SetStatus(juce::String("Refused: ") + juce::String(reason));
                    }
                });
            };
        }

        // Lays out `layout_` (headers interleaved with MappingRows, in the
        // exact order they were constructed) top-down at the current
        // rowsHost_ width -- shared by the constructor's initial layout and
        // resized()'s relayout so the two can never drift apart.
        void LayoutRows() {
            int y = 0;
            for (auto& [component, height] : layout_) {
                component->setBounds(0, y, rowsHost_.getWidth(), height);
                y += height;
            }
        }

        juce::Viewport viewport_;
        juce::Component rowsHost_;
        std::vector<std::unique_ptr<RowGroupHeader>> headers_;
        std::vector<std::unique_ptr<MappingRow>> rows_;
        std::vector<std::pair<juce::Component*, int>> layout_;
        int minContentWidth_ = 0;
    };

    // One controller row: name/kind/status dots/device combos/disclosure,
    // plus (when expanded) a stack of section headers each with their own
    // disclosure and SectionBody.
    class ControllerRow : public juce::Component {
    public:
        static constexpr int kHeaderHeight = 32;
        static constexpr int kSectionHeaderHeight = 24;

        ControllerRow(ControllersPage& page, std::size_t controllerIx, const synth::MidiControllerRowVM& rowVm)
            : page_(page), controllerIx_(controllerIx) {
            nameLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
            nameLabel_.setJustificationType(juce::Justification::centredLeft);
            nameLabel_.setText(juce::String(rowVm.name), juce::dontSendNotification);
            addAndMakeVisible(nameLabel_);

            kindLabel_.setColour(juce::Label::textColourId, juce::Colours::white);
            kindLabel_.setJustificationType(juce::Justification::centredLeft);
            kindLabel_.setText(juce::String(synth::MidiProfileKindName(rowVm.kind)), juce::dontSendNotification);
            addAndMakeVisible(kindLabel_);

            // Launchpad controller-variant selector (label-launchpad-brief.md
            // Change 2): launchpad-kind controllers only -- every other kind
            // shows no such combo (variantBox_ stays null, skipped entirely
            // in resized()/paint()).
            if (rowVm.kind == synth::MidiProfileKind::Launchpad) {
                variantBox_ = std::make_unique<juce::ComboBox>();
                const auto& catalog = synth::LaunchpadVariantCatalog();
                for (int ix = 0; ix < static_cast<int>(catalog.size()); ++ix) {
                    variantBox_->addItem(juce::String(catalog[ix]), ix + 1);
                }
                const int current = page_.vm_.LaunchpadVariantIndex(controllerIx_);
                if (current >= 0) {
                    variantBox_->setSelectedId(current + 1, juce::dontSendNotification);
                }
                variantBox_->onChange = [this] { OnVariantSelected(); };
                addAndMakeVisible(*variantBox_);
            }

            inputStatus_ = rowVm.inputStatus;
            outputStatus_ = rowVm.outputStatus;

            inputBox_.setTextWhenNoChoicesAvailable("No inputs");
            PopulateDeviceBox(inputBox_, page_.runtime_.MidiConnections().EnumerateNow().inputs, rowVm.inputStatus,
                              rowVm.inputDeviceLabel);
            addAndMakeVisible(inputBox_);
            inputBox_.onChange = [this] { OnDeviceSelected(/*output=*/false); };

            outputBox_.setTextWhenNoChoicesAvailable("No outputs");
            PopulateDeviceBox(outputBox_, page_.runtime_.MidiConnections().EnumerateNow().outputs, rowVm.outputStatus,
                              rowVm.outputDeviceLabel);
            addAndMakeVisible(outputBox_);
            outputBox_.onChange = [this] { OnDeviceSelected(/*output=*/true); };

            disclosureButton_.setButtonText(rowVm.configExpanded ? "v" : ">");
            disclosureButton_.onClick = [this] {
                // RebuildRows() destroys this ControllerRow -- and the very
                // button now mid-click -- so running it synchronously from the
                // click callback is a use-after-free (JUCE keeps touching the
                // freed button as the click unwinds). Defer until the click has
                // returned; guard with a SafePointer in case the page itself
                // goes away first.
                juce::Component::SafePointer<ControllersPage> safePage(&page_);
                const std::size_t ix = controllerIx_;
                juce::MessageManager::callAsync([safePage, ix] {
                    if (safePage == nullptr) {
                        return;
                    }
                    safePage->vm_.ToggleConfig(ix);
                    safePage->content_.RebuildRows();
                    safePage->resized();
                });
            };
            addAndMakeVisible(disclosureButton_);

            if (rowVm.configExpanded) {
                for (const synth::MidiConfigSection section : rowVm.sections) {
                    auto sectionButton = std::make_unique<juce::TextButton>();
                    const bool expanded = page_.vm_.SectionExpanded(controllerIx_, section);
                    sectionButton->setButtonText(juce::String(SectionName(section)) + (expanded ? " v" : " >"));
                    sectionButton->onClick = [this, section] {
                        // Same self-destruction hazard as the disclosure button
                        // above: RebuildRows() frees this row and this button
                        // mid-click. Defer past the click, SafePointer-guarded.
                        juce::Component::SafePointer<ControllersPage> safePage(&page_);
                        const std::size_t ix = controllerIx_;
                        juce::MessageManager::callAsync([safePage, ix, section] {
                            if (safePage == nullptr) {
                                return;
                            }
                            safePage->vm_.ToggleSection(ix, section);
                            safePage->content_.RebuildRows();
                            safePage->resized();
                        });
                    };
                    addAndMakeVisible(*sectionButton);
                    sectionButtons_.push_back(std::move(sectionButton));

                    if (expanded) {
                        auto body = std::make_unique<SectionBody>(page_, controllerIx_, section);
                        addAndMakeVisible(*body);
                        sectionBodies_.push_back(std::move(body));
                    } else {
                        sectionBodies_.push_back(nullptr);
                    }
                }
            }
        }

        bool HasFocusedEditor() const {
            for (const auto& body : sectionBodies_) {
                if (body && body->HasFocusedEditor()) {
                    return true;
                }
            }
            return false;
        }

        int PreferredHeight() const {
            int height = kHeaderHeight;
            for (const auto& body : sectionBodies_) {
                height += kSectionHeaderHeight;
                if (body) {
                    height += body->PreferredHeight();
                }
            }
            return height;
        }

        void resized() override {
            auto area = getLocalBounds();
            auto header = area.removeFromTop(kHeaderHeight);
            disclosureButton_.setBounds(header.removeFromLeft(24).reduced(2));
            nameLabel_.setBounds(header.removeFromLeft(juce::jmax(100, header.getWidth() / 6)));
            kindLabel_.setBounds(header.removeFromLeft(juce::jmax(80, header.getWidth() / 8)));
            // Launchpad variant combo (label-launchpad-brief.md Change 2):
            // reserved right after the kind label, only when present --
            // VariantBoxWidth()'s 0-when-absent return is what keeps
            // paint()'s status-dot offset (see VariantBoxWidth() doc
            // comment) in sync with this reservation for every controller
            // kind, launchpad or not.
            if (variantBox_) {
                variantBox_->setBounds(header.removeFromLeft(VariantBoxWidth()).reduced(2));
            }
            // Status dots painted directly in paint() over a fixed-width gap
            // reserved here (see paint()).
            header.removeFromLeft(kStatusDotsWidth);
            const int comboWidth = juce::jmax(120, header.getWidth() / 2);
            inputBox_.setBounds(header.removeFromLeft(comboWidth).reduced(2));
            outputBox_.setBounds(header.removeFromLeft(comboWidth).reduced(2));

            for (std::size_t ix = 0; ix < sectionButtons_.size(); ++ix) {
                auto sectionHeader = area.removeFromTop(kSectionHeaderHeight);
                sectionButtons_[ix]->setBounds(sectionHeader.removeFromLeft(200).reduced(2));
                if (sectionBodies_[ix]) {
                    auto bodyArea = area.removeFromTop(sectionBodies_[ix]->PreferredHeight());
                    sectionBodies_[ix]->setBounds(bodyArea);
                }
            }
        }

        void paint(juce::Graphics& g) override {
            // Status dots (binding: "per-endpoint status dots (Online green
            // / Offline red / Unconfigured grey)"), painted just left of the
            // device combos at a fixed offset matching the gap reserved in
            // resized() -- including the variant combo's width (0 when this
            // row has none, see VariantBoxWidth()) so non-launchpad rows'
            // dot position is unaffected.
            const int disclosureAndLabels = 24 + juce::jmax(100, (getWidth() - 24) / 6) +
                                            juce::jmax(80, (getWidth() - 24) / 8) + VariantBoxWidth();
            const int dotY = kHeaderHeight / 2;
            g.setColour(StatusColour(inputStatus_));
            g.fillEllipse(static_cast<float>(disclosureAndLabels + 4), static_cast<float>(dotY - 4), 8.0f, 8.0f);
            g.setColour(StatusColour(outputStatus_));
            g.fillEllipse(static_cast<float>(disclosureAndLabels + 18), static_cast<float>(dotY - 4), 8.0f, 8.0f);
        }

    private:
        static constexpr int kStatusDotsWidth = 32;
        static constexpr int kVariantBoxWidth = 140;

        // Width reserved for the launchpad variant combo -- kVariantBoxWidth
        // when this row has one (a Launchpad-kind controller), 0 otherwise.
        // Single source of truth shared by resized() (the reservation) and
        // paint() (the status-dot offset that must skip over it), so the two
        // can never drift apart the way two independent hardcoded widths
        // could.
        int VariantBoxWidth() const { return variantBox_ ? kVariantBoxWidth : 0; }

        static const char* SectionName(synth::MidiConfigSection section) {
            switch (section) {
                case synth::MidiConfigSection::Encoders:
                    return "Encoders";
                case synth::MidiConfigSection::SystemMessages:
                    return "System Messages";
                case synth::MidiConfigSection::Analogs:
                    return "Analogs";
            }
            return "";
        }

        static juce::Colour StatusColour(synth::MidiEndpointStatus status) {
            switch (status) {
                case synth::MidiEndpointStatus::Online:
                    return juce::Colours::limegreen;
                case synth::MidiEndpointStatus::Offline:
                    return juce::Colours::red;
                case synth::MidiEndpointStatus::Unconfigured:
                    break;
            }
            return juce::Colours::grey;
        }

        // Populates a device combo: "(none)" first, then every currently
        // enumerated device name, then -- only when the stored ref is
        // configured but does not name any currently-enumerated device (the
        // Offline case) -- one extra synthetic entry carrying the stored
        // label, so the combo still shows/lets the user re-affirm what's
        // configured even while the physical device is absent (Task 4 brief:
        // "the stored ref as an extra entry when configured-but-absent").
        // Item ids: 1 = "(none)", 2..N+1 = enumerated devices in order,
        // N+2 (when present) = the synthetic stored-ref entry.
        static void PopulateDeviceBox(juce::ComboBox& box, const std::vector<synth::MidiDeviceInfoRef>& devices,
                                      synth::MidiEndpointStatus status, const std::string& storedLabel) {
            box.clear(juce::dontSendNotification);
            box.addItem("(none)", 1);
            int id = 2;
            int selectedId = 1;
            for (const auto& device : devices) {
                box.addItem(juce::String(device.name), id);
                if (status == synth::MidiEndpointStatus::Online && device.name == storedLabel) {
                    selectedId = id;
                }
                ++id;
            }
            if (status == synth::MidiEndpointStatus::Offline) {
                box.addItem(juce::String(storedLabel), id);
                selectedId = id;
            } else if (status == synth::MidiEndpointStatus::Unconfigured) {
                selectedId = 1;
            }
            box.setSelectedId(selectedId, juce::dontSendNotification);
        }

        void OnDeviceSelected(bool output) {
            juce::ComboBox& box = output ? outputBox_ : inputBox_;
            const int selectedId = box.getSelectedId();
            const synth::MidiDeviceList devices = page_.runtime_.MidiConnections().EnumerateNow();
            const std::vector<synth::MidiDeviceInfoRef>& list = output ? devices.outputs : devices.inputs;

            if (selectedId == 1) {
                // "(none)" -- clear the ref via the VM path (see the class
                // doc comment's "Device-ref commit path"): SetEndpointRef ->
                // EditInstrument commit. The rebuilt callback + reconcile
                // pass then closes whatever was open (PlanMidiReconciliation
                // treats a newly-unconfigured ref that is currently Online as
                // a Close*+Mark*Offline case -- Task 4 review, Important
                // finding 3).
                synth::MidiInstrumentConfig out;
                if (page_.vm_.SetEndpointRef(controllerIx_, output, synth::MidiEndpointRef{}, out)) {
                    page_.Commit(std::move(out));
                    page_.SetStatus("Cleared device");
                }
                return;
            }

            const int deviceIx = selectedId - 2;
            if (deviceIx >= 0 && deviceIx < static_cast<int>(list.size())) {
                // Names an enumerated, currently-present device: route
                // through the same VM SetEndpointRef -> EditInstrument commit
                // path as every other edit on this page (class doc comment's
                // "Device-ref commit path" -- Task 4 review, Important
                // finding 3: ALL device combo changes go through the VM, not
                // a direct MidiConnectionManager::ManualOpen* call). The
                // rebuilt callback + reconcile pass opens the device itself,
                // exactly like a persisted runtime-config endpoint ref would be on load
                // -- self-healing, and the single path this page's own
                // rebuilt-hook subscription (finding 1) already dirties the
                // page for.
                const synth::MidiDeviceInfoRef& device = list[static_cast<std::size_t>(deviceIx)];
                synth::MidiEndpointRef ref;
                ref.identifier = device.identifier;
                ref.name = device.name;
                synth::MidiInstrumentConfig out;
                if (page_.vm_.SetEndpointRef(controllerIx_, output, ref, out)) {
                    page_.Commit(std::move(out));
                    page_.SetStatus(juce::String("Selected ") + juce::String(device.name));
                }
                return;
            }

            // Otherwise this is the synthetic "keep configured (offline)"
            // entry -- nothing to open; the ref is already what it was, so
            // this is a no-op selection (re-affirming the existing,
            // currently-absent configuration). No commit needed.
        }

        // Launchpad controller-variant combo's onChange (label-launchpad-
        // brief.md Change 2). Commits synchronously, same as
        // OnDeviceSelected()/every other combo on this page above -- this
        // does NOT call content_.RebuildRows() directly (only the
        // disclosure/section-toggle/add/delete buttons do that, which is
        // what makes THEM need the callAsync+SafePointer deferral), so no
        // self-destruction hazard here; the next RefreshOnTick() picks up
        // the committed change and rebuilds normally.
        void OnVariantSelected() {
            const int variantIndex = variantBox_->getSelectedId() - 1;
            if (variantIndex < 0) {
                return;
            }
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.SetLaunchpadVariant(controllerIx_, variantIndex, out, &reason)) {
                page_.Commit(std::move(out));
                page_.SetStatus(juce::String("Selected ") + juce::String(synth::LaunchpadVariantCatalog()[static_cast<std::size_t>(variantIndex)]));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
                // Resync the combo to the VM's actual current variant (the
                // refused selection must not stick displayed) -- same
                // "revert on refusal" contract every other editor/combo on
                // this page follows (see e.g. SystemMessageFieldEditor::Commit()).
                const int current = page_.vm_.LaunchpadVariantIndex(controllerIx_);
                variantBox_->setSelectedId(current >= 0 ? current + 1 : 0, juce::dontSendNotification);
            }
        }

        ControllersPage& page_;
        std::size_t controllerIx_;
        juce::Label nameLabel_;
        juce::Label kindLabel_;
        std::unique_ptr<juce::ComboBox> variantBox_;  // launchpad-kind controllers only; null otherwise
        juce::ComboBox inputBox_;
        juce::ComboBox outputBox_;
        juce::TextButton disclosureButton_;
        std::vector<std::unique_ptr<juce::TextButton>> sectionButtons_;
        std::vector<std::unique_ptr<SectionBody>> sectionBodies_;
        synth::MidiEndpointStatus inputStatus_;
        synth::MidiEndpointStatus outputStatus_;
    };

    // The "+" row at the bottom: name editor + kind combo + Add button.
    class AddControllerRow : public juce::Component {
    public:
        static constexpr int kHeight = 36;

        explicit AddControllerRow(ControllersPage& page) : page_(page) {
            nameEditor_.setTextToShowWhenEmpty("New controller name", juce::Colours::grey);
            addAndMakeVisible(nameEditor_);

            kindBox_.addItem("WRLD.Bldr", 1);
            kindBox_.addItem("MF Twister", 2);
            kindBox_.addItem("Launchpad", 3);
            kindBox_.addItem("Generic", 4);
            kindBox_.setSelectedId(1, juce::dontSendNotification);
            addAndMakeVisible(kindBox_);

            addButton_.setButtonText("Add");
            addButton_.onClick = [this] { OnAdd(); };
            addAndMakeVisible(addButton_);
        }

        bool HasFocusedEditor() const { return nameEditor_.hasKeyboardFocus(false); }

        void resized() override {
            auto area = getLocalBounds();
            nameEditor_.setBounds(area.removeFromLeft(juce::jmax(140, area.getWidth() / 3)).reduced(2));
            kindBox_.setBounds(area.removeFromLeft(140).reduced(2));
            addButton_.setBounds(area.removeFromLeft(70).reduced(2));
        }

    private:
        static synth::MidiProfileKind SelectedKind(int id) {
            switch (id) {
                case 2:
                    return synth::MidiProfileKind::MfTwister;
                case 3:
                    return synth::MidiProfileKind::Launchpad;
                case 4:
                    return synth::MidiProfileKind::Generic;
                case 1:
                default:
                    return synth::MidiProfileKind::WrldBldr;
            }
        }

        void OnAdd() {
            const std::string name = nameEditor_.getText().toStdString();
            if (name.empty()) {
                page_.SetStatus("Refused: name must not be empty");
                return;
            }
            synth::MidiInstrumentConfig out;
            std::string reason;
            if (page_.vm_.AddController(name, SelectedKind(kindBox_.getSelectedId()), out, &reason)) {
                page_.SetStatus("Added " + juce::String(name));
                nameEditor_.clear();
                page_.Commit(std::move(out));
            } else {
                page_.SetStatus(juce::String("Refused: ") + juce::String(reason));
            }
        }

        ControllersPage& page_;
        juce::TextEditor nameEditor_;
        juce::ComboBox kindBox_;
        juce::TextButton addButton_;
    };

    // The outer Viewport's content: one ControllerRow per VM controller plus
    // the AddControllerRow, stacked top-down.
    class Content : public juce::Component {
    public:
        explicit Content(ControllersPage& page) : page_(page) {}

        void RebuildRows() {
            rows_.clear();
            const auto& controllers = page_.vm_.Controllers();
            for (std::size_t ix = 0; ix < controllers.size(); ++ix) {
                rows_.push_back(std::make_unique<ControllerRow>(page_, ix, controllers[ix]));
                addAndMakeVisible(*rows_.back());
            }
            addRow_ = std::make_unique<AddControllerRow>(page_);
            addAndMakeVisible(*addRow_);
            LayoutRows();
        }

        bool HasFocusedEditor() const {
            for (const auto& row : rows_) {
                if (row->HasFocusedEditor()) {
                    return true;
                }
            }
            return addRow_ && addRow_->HasFocusedEditor();
        }

        int PreferredHeight() const {
            int height = 0;
            for (const auto& row : rows_) {
                height += row->PreferredHeight();
            }
            height += AddControllerRow::kHeight;
            return height;
        }

        void resized() override { LayoutRows(); }

    private:
        void LayoutRows() {
            int y = 0;
            const int width = getWidth() > 0 ? getWidth() : 400;
            for (auto& row : rows_) {
                const int height = row->PreferredHeight();
                row->setBounds(0, y, width, height);
                y += height;
            }
            if (addRow_) {
                addRow_->setBounds(0, y, width, AddControllerRow::kHeight);
                y += AddControllerRow::kHeight;
            }
        }

        ControllersPage& page_;
        std::vector<std::unique_ptr<ControllerRow>> rows_;
        std::unique_ptr<AddControllerRow> addRow_;
    };

    Runtime<App>& runtime_;
    synth::MidiConfigViewModel vm_;

    juce::TextButton backButton_;
    juce::Label statusLabel_;
    juce::Viewport viewport_;
    Content content_;

    bool dirty_ = true;
    std::string lastFingerprint_;
};

}  // namespace synth_runtime
