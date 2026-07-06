#pragma once

#include <algorithm>
#include <cstddef>
#include <filesystem>
#include <optional>
#include <string>
#include <system_error>
#include <vector>

namespace synth {

class PatchBrowser {
public:
    struct Entry {
        std::string name;
        std::filesystem::path relativePath;
        std::filesystem::path absolutePath;
    };

    PatchBrowser() = default;
    explicit PatchBrowser(std::filesystem::path patchesRoot) { SetRoot(std::move(patchesRoot)); }

    void SetRoot(std::filesystem::path patchesRoot) {
        rootPath_ = NormalizeRoot(std::move(patchesRoot));
        currentRelativePath_.clear();
        selectedIndex_ = 0;
        entries_.clear();
    }

    const std::filesystem::path& RootPath() const { return rootPath_; }
    const std::filesystem::path& CurrentRelativePath() const { return currentRelativePath_; }
    const std::vector<Entry>& Entries() const { return entries_; }
    std::size_t SelectedIndex() const { return selectedIndex_; }

    bool Refresh() {
        entries_.clear();
        selectedIndex_ = 0;

        const auto currentDirectory = ResolveLoadPath(currentRelativePath_);
        if (!currentDirectory.has_value()) {
            currentRelativePath_.clear();
        }
        const std::filesystem::path directory =
            currentDirectory.has_value() ? *currentDirectory : rootPath_;

        std::error_code ec;
        if (rootPath_.empty() || !std::filesystem::is_directory(directory, ec) || ec) {
            return false;
        }

        std::vector<Entry> nextEntries;
        std::filesystem::directory_iterator it(directory, ec);
        const std::filesystem::directory_iterator end;
        for (; !ec && it != end; it.increment(ec)) {
            const std::filesystem::directory_entry& entry = *it;
            if (ec) {
                break;
            }
            std::error_code entryEc;
            if (!entry.is_directory(entryEc) || entryEc || !IsExistingDirectoryUnderRoot(entry.path())) {
                continue;
            }

            std::filesystem::path relative = std::filesystem::relative(entry.path(), rootPath_, entryEc);
            if (entryEc || !IsSafeRelativePath(relative)) {
                continue;
            }

            nextEntries.push_back(Entry{
                .name = entry.path().filename().string(),
                .relativePath = relative.lexically_normal(),
                .absolutePath = (rootPath_ / relative).lexically_normal(),
            });
        }

        std::sort(nextEntries.begin(), nextEntries.end(), [](const Entry& a, const Entry& b) {
            return a.name < b.name;
        });
        entries_ = std::move(nextEntries);
        return !ec;
    }

    void Select(std::size_t index) {
        if (entries_.empty()) {
            selectedIndex_ = 0;
            return;
        }
        selectedIndex_ = std::min(index, entries_.size() - 1);
    }

    void MoveSelection(int delta) {
        if (entries_.empty() || delta == 0) {
            return;
        }
        if (delta < 0) {
            selectedIndex_ = (selectedIndex_ + entries_.size() - 1) % entries_.size();
        } else {
            selectedIndex_ = (selectedIndex_ + 1) % entries_.size();
        }
    }

    bool EnterSelected() {
        if (entries_.empty() || selectedIndex_ >= entries_.size()) {
            return false;
        }
        currentRelativePath_ = entries_[selectedIndex_].relativePath;
        return Refresh();
    }

    bool EnterParent() {
        if (currentRelativePath_.empty() || currentRelativePath_ == std::filesystem::path(".")) {
            return false;
        }
        currentRelativePath_ = currentRelativePath_.parent_path();
        if (currentRelativePath_ == std::filesystem::path(".")) {
            currentRelativePath_.clear();
        }
        return Refresh();
    }

    std::filesystem::path SelectedRelativePath() const {
        if (!entries_.empty() && selectedIndex_ < entries_.size()) {
            return entries_[selectedIndex_].relativePath;
        }
        return currentRelativePath_;
    }

    std::optional<std::filesystem::path> SelectedLoadPath() const {
        const std::filesystem::path relative = SelectedRelativePath();
        if (relative.empty() || relative == std::filesystem::path(".")) {
            return std::nullopt;
        }
        return ResolveLoadPath(relative);
    }

    std::optional<std::filesystem::path> ResolveLoadPath(const std::filesystem::path& relativePath) const {
        if (!IsSafeRelativePath(relativePath)) {
            return std::nullopt;
        }
        const std::filesystem::path normalizedRelative = relativePath.lexically_normal();
        const std::filesystem::path candidate = (rootPath_ / normalizedRelative).lexically_normal();

        std::error_code ec;
        if (!std::filesystem::is_directory(candidate, ec) || ec) {
            return std::nullopt;
        }
        if (!IsExistingDirectoryUnderRoot(candidate)) {
            return std::nullopt;
        }
        return candidate;
    }

    std::optional<std::filesystem::path> ResolveSaveAsCandidate(const std::string& patchName) const {
        const std::string trimmed = Trim(patchName);
        if (trimmed.empty()) {
            return std::nullopt;
        }

        const std::filesystem::path namePath(trimmed);
        if (namePath.is_absolute() || namePath.has_parent_path() || !IsSafeRelativePath(namePath)) {
            return std::nullopt;
        }
        if (namePath == std::filesystem::path(".") || namePath.filename().empty()) {
            return std::nullopt;
        }

        const std::filesystem::path candidate = (rootPath_ / namePath).lexically_normal();
        if (candidate == rootPath_ || !IsLexicallyUnderRoot(candidate)) {
            return std::nullopt;
        }
        return candidate;
    }

    std::optional<std::filesystem::path> ResolveSaveAsPath(const std::string& patchName) const {
        std::optional<std::filesystem::path> candidate = ResolveSaveAsCandidate(patchName);
        if (!candidate.has_value()) {
            return std::nullopt;
        }
        std::error_code ec;
        if (std::filesystem::exists(*candidate, ec) && !IsExistingDirectoryUnderRoot(*candidate)) {
            return std::nullopt;
        }
        return candidate;
    }

    std::optional<std::filesystem::path> ResolveNewSaveAsPath(const std::string& patchName) const {
        std::optional<std::filesystem::path> candidate = ResolveSaveAsCandidate(patchName);
        if (!candidate.has_value()) {
            return std::nullopt;
        }

        std::error_code ec;
        if (std::filesystem::exists(*candidate, ec) || ec) {
            return std::nullopt;
        }
        return candidate;
    }

private:
    std::filesystem::path rootPath_;
    std::filesystem::path currentRelativePath_;
    std::vector<Entry> entries_;
    std::size_t selectedIndex_ = 0;

    static std::filesystem::path NormalizeRoot(std::filesystem::path root) {
        if (root.empty()) {
            return {};
        }
        std::error_code ec;
        std::filesystem::path absolute = std::filesystem::absolute(root, ec);
        if (ec) {
            absolute = root;
        }
        std::filesystem::path canonical = std::filesystem::weakly_canonical(absolute, ec);
        return (ec ? absolute : canonical).lexically_normal();
    }

    static bool IsSafeRelativePath(const std::filesystem::path& path) {
        if (path.is_absolute()) {
            return false;
        }
        for (const std::filesystem::path& component : path) {
            if (component == std::filesystem::path("..")) {
                return false;
            }
        }
        return true;
    }

    static bool IsSameOrChildPath(const std::filesystem::path& root, const std::filesystem::path& target) {
        const std::filesystem::path normalizedRoot = root.lexically_normal();
        const std::filesystem::path normalizedTarget = target.lexically_normal();
        auto rootIt = normalizedRoot.begin();
        auto targetIt = normalizedTarget.begin();
        for (; rootIt != normalizedRoot.end(); ++rootIt, ++targetIt) {
            if (targetIt == normalizedTarget.end() || *rootIt != *targetIt) {
                return false;
            }
        }
        return true;
    }

    bool IsLexicallyUnderRoot(const std::filesystem::path& target) const {
        return !rootPath_.empty() && IsSameOrChildPath(rootPath_, target);
    }

    bool IsExistingDirectoryUnderRoot(const std::filesystem::path& directory) const {
        if (rootPath_.empty()) {
            return false;
        }
        std::error_code ec;
        const std::filesystem::path canonicalRoot = std::filesystem::weakly_canonical(rootPath_, ec);
        if (ec) {
            return false;
        }
        const std::filesystem::path canonicalDirectory = std::filesystem::weakly_canonical(directory, ec);
        if (ec) {
            return false;
        }
        return IsSameOrChildPath(canonicalRoot, canonicalDirectory);
    }

    static std::string Trim(const std::string& value) {
        const std::string whitespace = " \t\n\r\f\v";
        const std::size_t first = value.find_first_not_of(whitespace);
        if (first == std::string::npos) {
            return {};
        }
        const std::size_t last = value.find_last_not_of(whitespace);
        return value.substr(first, last - first + 1);
    }
};

}  // namespace synth
