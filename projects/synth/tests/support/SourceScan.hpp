#pragma once

#include <filesystem>
#include <fstream>
#include <regex>
#include <sstream>
#include <stdexcept>
#include <string>

namespace synth::test {

inline std::string ReadSourceFile(const std::filesystem::path& path)
{
    std::ifstream in(path);
    if (!in)
    {
        throw std::runtime_error("failed to open source file: " + path.string());
    }
    std::ostringstream out;
    out << in.rdbuf();
    return out.str();
}

inline bool SourceContainsFieldByFieldNodeInit(const std::filesystem::path& path)
{
    const std::string source = ReadSourceFile(path);
    const std::regex declaration(R"(\b(?:synth::)?ui::Node\s+([A-Za-z_][A-Za-z0-9_]*)\s*;)");
    for (std::sregex_iterator it(source.begin(), source.end(), declaration), end; it != end; ++it)
    {
        const std::string variable = (*it)[1].str();
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
