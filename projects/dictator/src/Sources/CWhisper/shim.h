#if __has_include(<whisper.h>)
#include <whisper.h>
#elif __has_include("/opt/homebrew/opt/whisper-cpp/libexec/include/whisper.h")
#include "/opt/homebrew/opt/whisper-cpp/libexec/include/whisper.h"
#elif __has_include("/opt/homebrew/opt/whisper-cpp/include/whisper.h")
#include "/opt/homebrew/opt/whisper-cpp/include/whisper.h"
#elif __has_include("/usr/local/opt/whisper-cpp/libexec/include/whisper.h")
#include "/usr/local/opt/whisper-cpp/libexec/include/whisper.h"
#elif __has_include("/usr/local/opt/whisper-cpp/include/whisper.h")
#include "/usr/local/opt/whisper-cpp/include/whisper.h"
#else
#error "whisper.h not found. Install whisper-cpp via Homebrew."
#endif

#if __has_include(<ggml-backend.h>)
#include <ggml-backend.h>
#elif __has_include("/opt/homebrew/opt/whisper-cpp/libexec/include/ggml-backend.h")
#include "/opt/homebrew/opt/whisper-cpp/libexec/include/ggml-backend.h"
#elif __has_include("/opt/homebrew/opt/whisper-cpp/libexec/include/ggml/ggml-backend.h")
#include "/opt/homebrew/opt/whisper-cpp/libexec/include/ggml/ggml-backend.h"
#elif __has_include("/opt/homebrew/opt/ggml/include/ggml-backend.h")
#include "/opt/homebrew/opt/ggml/include/ggml-backend.h"
#elif __has_include("/usr/local/opt/whisper-cpp/libexec/include/ggml-backend.h")
#include "/usr/local/opt/whisper-cpp/libexec/include/ggml-backend.h"
#elif __has_include("/usr/local/opt/whisper-cpp/libexec/include/ggml/ggml-backend.h")
#include "/usr/local/opt/whisper-cpp/libexec/include/ggml/ggml-backend.h"
#elif __has_include("/usr/local/opt/ggml/include/ggml-backend.h")
#include "/usr/local/opt/ggml/include/ggml-backend.h"
#else
#error "ggml-backend.h not found. Install whisper-cpp/ggml via Homebrew."
#endif
