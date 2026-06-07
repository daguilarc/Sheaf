#if __has_include("/opt/homebrew/Cellar/whisper-cpp/1.8.3/libexec/include/whisper.h")
#include "/opt/homebrew/Cellar/whisper-cpp/1.8.3/libexec/include/whisper.h"
#elif __has_include("/opt/homebrew/include/whisper.h")
#include "/opt/homebrew/include/whisper.h"
#elif __has_include("/usr/local/include/whisper.h")
#include "/usr/local/include/whisper.h"
#else
#error "whisper.h not found. Install whisper-cpp via Homebrew."
#endif
