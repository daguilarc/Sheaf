#pragma once

#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>

namespace synth::test {

inline std::filesystem::path ResolveSourcePath(const std::filesystem::path& path)
{
    if (path.is_absolute())
    {
        return path;
    }

    std::filesystem::path prefix = std::filesystem::current_path();
    while (!prefix.empty())
    {
        const std::filesystem::path candidate = prefix / path;
        if (std::filesystem::exists(candidate))
        {
            return candidate;
        }

        const std::filesystem::path next = prefix.parent_path();
        if (next == prefix)
        {
            break;
        }
        prefix = next;
    }
    return path;
}

inline std::string ReadSourceFile(const std::filesystem::path& path)
{
    const std::filesystem::path resolved = ResolveSourcePath(path);
    std::ifstream in(resolved);
    if (!in)
    {
        throw std::runtime_error("failed to open source file: " + path.string());
    }
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

// Comments describe constraints and counterexamples. Strip them before source
// shape scans so documentation does not satisfy or fail implementation checks.
inline std::string StripComments(const std::string& source)
{
    std::string stripped;
    stripped.reserve(source.size());
    for (std::size_t i = 0; i < source.size();)
    {
        if (source.compare(i, 2, "//") == 0)
        {
            const std::size_t lineEnd = source.find('\n', i);
            i = lineEnd == std::string::npos ? source.size() : lineEnd;
            continue;
        }
        if (source.compare(i, 2, "/*") == 0)
        {
            const std::size_t blockEnd = source.find("*/", i + 2);
            i = blockEnd == std::string::npos ? source.size() : blockEnd + 2;
            continue;
        }
        stripped.push_back(source[i]);
        ++i;
    }
    return stripped;
}

// True when a source builds a `ui::Node` VALUE by hand: a local declaration
// followed by field assignments, a braced initializer, or any copy-initialized
// local. That is broader than "field-by-field assignment", which is what this
// predicate used to be named -- `ui::Node n = *found;` is a plain copy and it
// reports true. The breadth is deliberate rather than accidental, and renaming
// is the fix task 7.1 chose over narrowing: sru-43's inspection asks whether a
// producer hand-assembles nodes at all, and a local node value copied out of a
// tree, mutated, and pushed back is hand assembly however it was initialized.
// A `ui::Node` function parameter, reference, or container element is NOT
// flagged: those consume nodes rather than construct them.
inline bool SourceAssemblesUiNodeByHand(const std::filesystem::path& path)
{
    const std::string source = StripComments(ReadSourceFile(path));
    const std::regex declaration(
        R"(\b(?:synth::)?ui::Node\s+([A-Za-z_][A-Za-z0-9_]*)\s*(;|\{|=))");
    for (std::sregex_iterator it(source.begin(), source.end(), declaration), end; it != end; ++it)
    {
        const std::string variable = (*it)[1].str();
        const std::string initializer = (*it)[2].str();
        if (initializer == "{" || initializer == "=")
        {
            return true;
        }

        const std::size_t afterDeclaration =
            static_cast<std::size_t>((*it).position() + (*it).length());
        const std::string rest = source.substr(afterDeclaration);
        std::smatch nextMatch;
        const bool hasNextDeclaration = std::regex_search(rest, nextMatch, declaration);
        const std::string block = source.substr(
            afterDeclaration,
            hasNextDeclaration ? static_cast<std::size_t>(nextMatch.position())
                               : std::string::npos);
        const std::regex fieldAssignment("\\b" + variable + R"(\.[A-Za-z_][A-Za-z0-9_]*\s*=)");
        if (std::regex_search(block, fieldAssignment))
        {
            return true;
        }
    }
    return false;
}

}  // namespace synth::test
