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
// device itself, self-healing exactly like a patch-carried endpoint ref
// would be picked up on load. This also means an endpoint that was Online
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
// cause (this page's own Commit(), a patch load/revert, or any other
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
        // finding 1) -- not just this page's own edits. A patch load/revert
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

    // One mapping-list row: a label plus editors for its editableFields.
    class MappingRow : public juce::Component {
    public:
        static constexpr int kHeight = 28;

        MappingRow(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                  std::size_t rowIx, const synth::MidiMappingRowVM& rowVm)
            : label_() {
            label_.setColour(juce::Label::textColourId, juce::Colours::white);
            label_.setJustificationType(juce::Justification::centredLeft);
            label_.setText(juce::String(rowVm.label), juce::dontSendNotification);
            addAndMakeVisible(label_);

            for (const synth::MidiMappingRowVM::Field field : rowVm.editableFields) {
                if (field == synth::MidiMappingRowVM::Field::PressMessage ||
                    field == synth::MidiMappingRowVM::Field::ReleaseMessage) {
                    auto editor = std::make_unique<SystemMessageFieldEditor>(page, controllerIx, rowIx, field);
                    addAndMakeVisible(*editor);
                    systemMessageEditors_.push_back(std::move(editor));
                } else if (field == synth::MidiMappingRowVM::Field::RelativeMode) {
                    // Issue #9: Mode is a dropdown over RelativeModeCatalog(),
                    // not a numeric editor.
                    auto editor = std::make_unique<RelativeModeFieldEditor>(page, controllerIx, section, rowIx);
                    addAndMakeVisible(*editor);
                    relativeModeEditors_.push_back(std::move(editor));
                } else {
                    double initial = 0.0;
                    page.vm_.RowFieldValue(controllerIx, section, rowIx, field, initial);
                    auto editor =
                        std::make_unique<NumericFieldEditor>(page, controllerIx, section, rowIx, field, initial);
                    addAndMakeVisible(*editor);
                    numericEditors_.push_back(std::move(editor));
                }
            }
        }

        bool HasFocusedEditor() const {
            for (const auto& editor : numericEditors_) {
                if (editor->hasKeyboardFocus(false)) {
                    return true;
                }
            }
            for (const auto& editor : systemMessageEditors_) {
                if (editor->hasKeyboardFocus(true)) {
                    return true;
                }
            }
            for (const auto& editor : relativeModeEditors_) {
                if (editor->hasKeyboardFocus(true)) {
                    return true;
                }
            }
            return false;
        }

        void resized() override {
            auto area = getLocalBounds();
            label_.setBounds(area.removeFromLeft(juce::jmax(160, area.getWidth() / 3)));
            constexpr int kEditorWidth = 90;
            for (auto& editor : numericEditors_) {
                editor->setBounds(area.removeFromLeft(kEditorWidth).reduced(2));
            }
            for (auto& editor : systemMessageEditors_) {
                editor->setBounds(area.removeFromLeft(2 * kEditorWidth).reduced(2));
            }
            for (auto& editor : relativeModeEditors_) {
                editor->setBounds(area.removeFromLeft(2 * kEditorWidth).reduced(2));
            }
        }

    private:
        juce::Label label_;
        std::vector<std::unique_ptr<NumericFieldEditor>> numericEditors_;
        std::vector<std::unique_ptr<SystemMessageFieldEditor>> systemMessageEditors_;
        std::vector<std::unique_ptr<RelativeModeFieldEditor>> relativeModeEditors_;
    };

    // A thin divider + column-header row inserted above each contiguous run
    // of same-`RowGroup` rows (issue #9 -- "each contiguous group of
    // same-schema rows gets a header row naming its columns"; issue #11 --
    // the scene-blend group additionally gets a distinct caption so it reads
    // as clearly separate from the gesture rows above it, not just another
    // row in the same list). Column labels come from FieldShortLabel() over
    // the first row of the group's editableFields -- the single source of
    // truth for both what a row renders and what its header calls it, so
    // the two can never drift apart. Mode/Step/SceneBlend groups (which are
    // not tabular chan/cc/... rows) show a short caption instead of/beside
    // column labels.
    class RowGroupHeader : public juce::Component {
    public:
        static constexpr int kHeight = 22;

        RowGroupHeader(synth::MidiMappingRowVM::RowGroup group, const std::vector<synth::MidiMappingRowVM::Field>& fields) {
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
            }
        }

        void paint(juce::Graphics& g) override {
            g.setColour(juce::Colours::darkgrey);
            g.fillRect(0, 0, getWidth(), 1);
        }

        void resized() override {
            auto area = getLocalBounds();
            area.removeFromTop(2);  // clears the divider rule painted at y=0
            captionLabel_.setBounds(area.removeFromLeft(juce::jmax(160, area.getWidth() / 3)));
            constexpr int kEditorWidth = 90;
            for (auto& label : columnLabels_) {
                label->setBounds(area.removeFromLeft(kEditorWidth).reduced(2));
            }
        }

    private:
        juce::Label captionLabel_;
        std::vector<std::unique_ptr<juce::Label>> columnLabels_;
    };

    // A section's body: its own inner juce::Viewport over a stack of
    // MappingRows, with a RowGroupHeader (divider + column labels) inserted
    // wherever a row's `group` differs from the previous row's (issue #9's
    // headers/dividers, issue #11's scene-blend separation) -- see
    // RowGroupHeader's doc comment (binding: "Mapping lists live inside
    // juce::Viewports").
    class SectionBody : public juce::Component {
    public:
        static constexpr int kMaxVisibleHeight = 220;

        SectionBody(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section) {
            const std::vector<synth::MidiMappingRowVM> rows = page.vm_.SectionRows(controllerIx, section);

            int totalHeight = 0;
            std::optional<synth::MidiMappingRowVM::RowGroup> previousGroup;
            for (std::size_t rowIx = 0; rowIx < rows.size(); ++rowIx) {
                if (!previousGroup.has_value() || *previousGroup != rows[rowIx].group) {
                    auto header = std::make_unique<RowGroupHeader>(rows[rowIx].group, rows[rowIx].editableFields);
                    rowsHost_.addAndMakeVisible(*header);
                    layout_.push_back({header.get(), RowGroupHeader::kHeight});
                    headers_.push_back(std::move(header));
                    totalHeight += RowGroupHeader::kHeight;
                    previousGroup = rows[rowIx].group;
                }
                auto row = std::make_unique<MappingRow>(page, controllerIx, section, rowIx, rows[rowIx]);
                rowsHost_.addAndMakeVisible(*row);
                layout_.push_back({row.get(), MappingRow::kHeight});
                totalHeight += MappingRow::kHeight;
                rows_.push_back(std::move(row));
            }
            rowsHost_.setSize(1, totalHeight);
            LayoutRows();

            viewport_.setViewedComponent(&rowsHost_, false);
            viewport_.setScrollBarsShown(true, false);
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
            rowsHost_.setSize(getWidth() - viewport_.getScrollBarThickness(), rowsHost_.getHeight());
            LayoutRows();
        }

    private:
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
            // resized().
            const int disclosureAndLabels = 24 + juce::jmax(100, (getWidth() - 24) / 6) + juce::jmax(80, (getWidth() - 24) / 8);
            const int dotY = kHeaderHeight / 2;
            g.setColour(StatusColour(inputStatus_));
            g.fillEllipse(static_cast<float>(disclosureAndLabels + 4), static_cast<float>(dotY - 4), 8.0f, 8.0f);
            g.setColour(StatusColour(outputStatus_));
            g.fillEllipse(static_cast<float>(disclosureAndLabels + 18), static_cast<float>(dotY - 4), 8.0f, 8.0f);
        }

    private:
        static constexpr int kStatusDotsWidth = 32;

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
                // exactly like a patch-carried endpoint ref would be on load
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

        ControllersPage& page_;
        std::size_t controllerIx_;
        juce::Label nameLabel_;
        juce::Label kindLabel_;
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
