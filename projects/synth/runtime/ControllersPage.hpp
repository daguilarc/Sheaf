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
// Device-ref commit path (Task 4 brief step 2, "choose the honest wiring,
// documenting it"): the brief allows either
// MidiConnectionManager::ManualOpenInput/ManualOpenOutput (which opens the
// device immediately, records the ref, AND updates connection state in one
// call -- see that method's doc comment) or the plain VM
// SetEndpointRef->EditInstrument commit (self-healing: the resulting ref
// write triggers a reconcile pass via the rebuilt callback, which opens the
// device itself as part of PlanMidiReconciliation's normal matching, exactly
// like a patch-carried endpoint ref would be picked up on load). This page
// uses ManualOpenInput/ManualOpenOutput for a combo selection that names an
// enumerated (currently-present) device -- so the open happens synchronously
// and status dots update on this same tick, matching the immediate feedback
// a device combo implies -- and falls back to the ref-only
// SetEndpointRef->EditInstrument path only for the synthetic "keep configured
// (offline)" entry (selecting the stored-but-absent ref back after having
// picked something else, or re-selecting "(none)" to clear it), where there
// is no device to open. Both paths converge on the same
// MidiConnectionManager-owned state and the same reconcile machinery, so
// status dots are correct either way; ManualOpen* is simply the more direct
// (and honest -- it's what the manager's own doc comment says UI-driven
// opens should use) of the two for the common case.
//
// Refresh discipline (Task 4 brief step 4): RefreshOnTick() rebuilds the VM
// from engine.InstrumentSnapshot() + connectionManager.State() only when
// dirty_ is set. dirty_ starts true (first tick must build the initial
// tree) and is set again by (a) the engine's rebuilt-callback (wired by
// Runtime to also touch this page, via SetInstrumentChangedHook) and (b) a
// per-tick comparison against a cheap MidiConnectionManager state change
// counter is unnecessary here -- MidiConnectionManager has no such counter,
// so this page instead treats "connection state may have changed" the same
// as every other page's per-tick refresh (AudioConfigPage/FilePage both
// unconditionally re-read their own status every tick): it re-derives a
// lightweight fingerprint (controller count + each slot's input/output
// status) once per tick and only calls vm_.Rebuild() when that fingerprint
// or the instrument-changed flag differs from last tick. This is the "cheap
// change counter" the brief allows ("add a cheap change counter if needed").
// Rebuild() is skipped entirely whenever any editor row currently has
// keyboard focus (editorFocusGuard_), so in-progress typing is never
// clobbered -- see HasFocusedEditor().

#include "synth/AppConcepts.hpp"
#include "synth/Engine.hpp"
#include "synth/MidiConfigViewModel.hpp"
#include "synth/MidiController.hpp"
#include "synth/MidiReconcile.hpp"

#include "MidiConnectionManager.hpp"

#include <juce_gui_basics/juce_gui_basics.h>

#include <cstddef>
#include <functional>
#include <memory>
#include <string>
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

        dirty_ = true;
        RefreshOnTick();
    }

    ControllersPage(const ControllersPage&) = delete;
    ControllersPage& operator=(const ControllersPage&) = delete;

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

    // One editable numeric field (juce::TextEditor) bound to a single
    // (controllerIx, section, rowIx, Field) edit target. Commits on
    // focus-loss/return (binding, p4-globals.md), never per keystroke.
    class NumericFieldEditor : public juce::TextEditor, private juce::TextEditor::Listener {
    public:
        NumericFieldEditor(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section,
                           std::size_t rowIx, synth::MidiMappingRowVM::Field field, double initialValue)
            : page_(page), controllerIx_(controllerIx), section_(section), rowIx_(rowIx), field_(field) {
            setText(juce::String(initialValue, 4), juce::dontSendNotification);
            setSelectAllWhenFocused(true);
            addListener(this);
        }

        ~NumericFieldEditor() override { removeListener(this); }

    private:
        void textEditorFocusLost(juce::TextEditor&) override { Commit(); }
        void textEditorReturnKeyPressed(juce::TextEditor&) override { Commit(); }

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
                setText(juce::String(page_.RowFieldCurrentValue(controllerIx_, section_, rowIx_, field_), 4),
                       juce::dontSendNotification);
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
                } else {
                    const double initial = page.RowFieldCurrentValue(controllerIx, section, rowIx, field);
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
        }

    private:
        juce::Label label_;
        std::vector<std::unique_ptr<NumericFieldEditor>> numericEditors_;
        std::vector<std::unique_ptr<SystemMessageFieldEditor>> systemMessageEditors_;
    };

    // A section's body: its own inner juce::Viewport over a stack of
    // MappingRows (binding: "Mapping lists live inside juce::Viewports").
    class SectionBody : public juce::Component {
    public:
        static constexpr int kMaxVisibleHeight = 220;

        SectionBody(ControllersPage& page, std::size_t controllerIx, synth::MidiConfigSection section) {
            const std::vector<synth::MidiMappingRowVM> rows = page.vm_.SectionRows(controllerIx, section);
            rowsHost_.setSize(1, static_cast<int>(rows.size()) * MappingRow::kHeight);
            int y = 0;
            for (std::size_t rowIx = 0; rowIx < rows.size(); ++rowIx) {
                auto row = std::make_unique<MappingRow>(page, controllerIx, section, rowIx, rows[rowIx]);
                row->setBounds(0, y, rowsHost_.getWidth(), MappingRow::kHeight);
                rowsHost_.addAndMakeVisible(*row);
                y += MappingRow::kHeight;
                rows_.push_back(std::move(row));
            }
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
            int y = 0;
            for (auto& row : rows_) {
                row->setBounds(0, y, rowsHost_.getWidth(), MappingRow::kHeight);
                y += MappingRow::kHeight;
            }
        }

    private:
        juce::Viewport viewport_;
        juce::Component rowsHost_;
        std::vector<std::unique_ptr<MappingRow>> rows_;
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
                page_.vm_.ToggleConfig(controllerIx_);
                page_.content_.RebuildRows();
                page_.resized();
            };
            addAndMakeVisible(disclosureButton_);

            if (rowVm.configExpanded) {
                for (const synth::MidiConfigSection section : rowVm.sections) {
                    auto sectionButton = std::make_unique<juce::TextButton>();
                    const bool expanded = page_.vm_.SectionExpanded(controllerIx_, section);
                    sectionButton->setButtonText(juce::String(SectionName(section)) + (expanded ? " v" : " >"));
                    sectionButton->onClick = [this, section] {
                        page_.vm_.ToggleSection(controllerIx_, section);
                        page_.content_.RebuildRows();
                        page_.resized();
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
                // "(none)" -- clear the ref via the plain VM path (no device
                // to open). See the class doc comment's "Device-ref commit
                // path".
                synth::MidiInstrumentConfig out;
                if (page_.vm_.SetEndpointRef(controllerIx_, output, synth::MidiEndpointRef{}, out)) {
                    page_.Commit(std::move(out));
                    page_.SetStatus("Cleared device");
                }
                return;
            }

            const int deviceIx = selectedId - 2;
            if (deviceIx >= 0 && deviceIx < static_cast<int>(list.size())) {
                // Names an enumerated, currently-present device: open it
                // directly via the manager (immediate feedback path -- see
                // the class doc comment).
                const synth::MidiDeviceInfoRef& device = list[static_cast<std::size_t>(deviceIx)];
                const bool opened = output
                                        ? page_.runtime_.MidiConnections().ManualOpenOutput(controllerIx_, device.identifier,
                                                                                            device.name)
                                        : page_.runtime_.MidiConnections().ManualOpenInput(controllerIx_, device.identifier,
                                                                                           device.name);
                page_.dirty_ = true;
                page_.SetStatus(opened ? juce::String("Opened ") + juce::String(device.name)
                                       : juce::String("Failed to open ") + juce::String(device.name));
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

    // Reads the current value of an editable numeric field straight off the
    // VM's underlying instrument snapshot, for (re-)initializing a
    // NumericFieldEditor's displayed text (both on first construction and
    // after a refused edit reverts it). Goes through SectionRows'
    // row-identification the same way ApplyMappingEdit does, but reads
    // rather than writes -- there is no VM accessor for "current value of a
    // single field" beyond SystemMessageChoiceIndex (Press/Release only), so
    // this walks the same instrument snapshot structure ApplyMappingEdit's
    // .cpp does, via a zero-effect probe edit: passing the field's own
    // current value back into ApplyMappingEdit is not an option (it has no
    // "read" mode), so this reconstructs the value directly.
    double RowFieldCurrentValue(std::size_t controllerIx, synth::MidiConfigSection section, std::size_t rowIx,
                                synth::MidiMappingRowVM::Field field) const {
        const synth::MidiInstrumentConfig snapshot = runtime_.GetEngine().InstrumentSnapshot();
        if (controllerIx >= snapshot.controllers.size()) {
            return 0.0;
        }
        const synth::MidiControllerSlot& slot = snapshot.controllers[controllerIx];
        using Field = synth::MidiMappingRowVM::Field;

        if (section == synth::MidiConfigSection::Encoders && slot.config.encoderInput.has_value()) {
            const auto& encoderInput = *slot.config.encoderInput;
            std::size_t ix = 0;
            for (const auto& mapping : encoderInput.turns) {
                if (ix == rowIx) {
                    return FieldFromEncoderMapping(mapping, field);
                }
                ++ix;
            }
            for (const auto& mapping : encoderInput.pushes) {
                if (ix == rowIx) {
                    return FieldFromEncoderMapping(mapping, field);
                }
                ++ix;
            }
            if (ix == rowIx && field == Field::RelativeMode) {
                return encoderInput.relativeMode == synth::EncoderRelativeMode::DirectionOnly ? 1.0 : 0.0;
            }
            ++ix;
            if (ix == rowIx && field == Field::TurnStep) {
                return static_cast<double>(encoderInput.turnStep);
            }
        } else if (section == synth::MidiConfigSection::Analogs && slot.config.analogInput.has_value()) {
            const auto& analogInput = *slot.config.analogInput;
            std::size_t ix = 0;
            for (const auto& mapping : analogInput.gestures) {
                if (ix == rowIx) {
                    if (field == Field::Channel) {
                        return static_cast<double>(mapping.control.channel);
                    }
                    if (field == Field::Cc) {
                        return static_cast<double>(mapping.control.cc);
                    }
                    if (field == Field::GestureIx) {
                        return static_cast<double>(mapping.gestureIx);
                    }
                }
                ++ix;
            }
            if (ix == rowIx && field == Field::SceneBlend && analogInput.sceneBlend.has_value()) {
                return static_cast<double>(analogInput.sceneBlend->cc);
            }
        } else if (section == synth::MidiConfigSection::SystemMessages && rowIx < slot.config.systemMessages.size()) {
            const auto& association = slot.config.systemMessages[rowIx];
            switch (field) {
                case Field::Channel:
                    return association.control.has_value() ? static_cast<double>(association.control->channel) : 0.0;
                case Field::Cc:
                    return association.control.has_value() ? static_cast<double>(association.control->cc) : 0.0;
                case Field::LaunchpadX:
                    return association.launchpadPosition.has_value()
                              ? static_cast<double>(association.launchpadPosition->x)
                              : 0.0;
                case Field::LaunchpadY:
                    return association.launchpadPosition.has_value()
                              ? static_cast<double>(association.launchpadPosition->y)
                              : 0.0;
                case Field::WrldBldrX:
                    return association.wrldBldrPosition.has_value()
                              ? static_cast<double>(association.wrldBldrPosition->x)
                              : 0.0;
                case Field::WrldBldrY:
                    return association.wrldBldrPosition.has_value()
                              ? static_cast<double>(association.wrldBldrPosition->y)
                              : 0.0;
                default:
                    break;
            }
        }
        return 0.0;
    }

    static double FieldFromEncoderMapping(const synth::EncoderMidiMapping& mapping,
                                          synth::MidiMappingRowVM::Field field) {
        using Field = synth::MidiMappingRowVM::Field;
        switch (field) {
            case Field::Channel:
                return static_cast<double>(mapping.control.channel);
            case Field::Cc:
                return static_cast<double>(mapping.control.cc);
            case Field::SlotIx:
                return static_cast<double>(mapping.slotIx);
            case Field::Position:
                return static_cast<double>(mapping.position);
            default:
                return 0.0;
        }
    }

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
