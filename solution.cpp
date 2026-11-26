#include <algorithm>
#include <cerrno>
#include <charconv>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#ifdef D_DEBUG
#include <iostream>
#include <chrono>
#endif

struct Arena {
    char* base = nullptr;
    size_t capacity = 0;
    size_t offset = 0;

    explicit Arena(size_t cap) : capacity(cap) {
        base = static_cast<char*>(::operator new(cap));
    }
    ~Arena() {
        ::operator delete(base);
    }
    Arena(const Arena&) = delete;
    Arena& operator=(const Arena&) = delete;

    void* allocate(size_t bytes, size_t align) {
        size_t aligned = (offset + align - 1) & ~(align - 1);
        if (aligned + bytes > capacity) {
            return ::operator new(bytes);
        }
        offset = aligned + bytes;
        return base + aligned;
    }

    bool owns(const void* p) const noexcept {
        const char* cp = static_cast<const char*>(p);
        return cp >= base && cp < base + capacity;
    }
};

template <typename T>
struct ArenaAllocator {
    using value_type = T;
    Arena* arena;

    explicit ArenaAllocator(Arena* a) noexcept : arena(a) {}
    template <typename U>
    ArenaAllocator(const ArenaAllocator<U>& other) noexcept : arena(other.arena) {}

    T* allocate(size_t n) {
        return static_cast<T*>(arena->allocate(n * sizeof(T), alignof(T)));
    }
    void deallocate(T* p, size_t) noexcept {
        if (!arena->owns(p)) {
            ::operator delete(p);
        }
    }
    template <typename U>
    bool operator==(const ArenaAllocator<U>& o) const noexcept {
        return arena == o.arena;
    }
    template <typename U>
    bool operator!=(const ArenaAllocator<U>& o) const noexcept {
        return arena != o.arena;
    }
};

struct Student {
    std::string_view full_name;
    int group;
    double gpa;
    int missed;
};

bool parse_int_fast(std::string_view sv, int& out) {
    if (sv.empty()) return false;
    for (char c : sv) {
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') return false;
    }
    if (sv.front() == '+') {
        sv.remove_prefix(1);
        if (sv.empty()) return false;
    }
    auto [ptr, ec] = std::from_chars(sv.data(), sv.data() + sv.size(), out);
    return ec == std::errc() && ptr == sv.data() + sv.size();
}

bool parse_double_fast(std::string_view sv, double& out) {
    if (sv.empty()) return false;
    bool has_digit = false;
    char stack_buf[128];
    std::string owned;
    char* buf = stack_buf;
    if (sv.size() >= sizeof(stack_buf)) {
        owned.resize(sv.size() + 1);
        buf = owned.data();
    }
    for (size_t i = 0; i < sv.size(); ++i) {
        char c = sv[i];
        if (c >= '0' && c <= '9') has_digit = true;
        else if (c != '.' && c != '-' && c != '+' && c != 'e' && c != 'E') return false;
        buf[i] = c;
    }
    if (!has_digit) return false;
    buf[sv.size()] = '\0';

    errno = 0;
    char* end = nullptr;
    double val = std::strtod(buf, &end);
    if (end != buf + sv.size() || !std::isfinite(val)) return false;
    out = val;
    return true;
}

bool forbidden_codepoint(unsigned cp) {
    if (cp < 0x20 || (cp >= 0x7F && cp <= 0x9F)) return true;
    if (cp == 0x00AD || cp == 0x034F || cp == 0x061C || cp == 0x180E || cp == 0xFEFF || cp == 0xFFFD) return true;
    if (cp >= 0x200B && cp <= 0x200F) return true;
    if (cp >= 0x2028 && cp <= 0x202E) return true;
    if (cp >= 0x2060 && cp <= 0x206F) return true;
    if (cp >= 0xFE00 && cp <= 0xFE0F) return true;
    if (cp >= 0xFFF9 && cp <= 0xFFFB) return true;
    return false;
}

bool is_combining_mark(unsigned cp) {
    return (cp >= 0x0300 && cp <= 0x036F) ||
           (cp >= 0x0483 && cp <= 0x0489) ||
           (cp >= 0x1AB0 && cp <= 0x1AFF) ||
           (cp >= 0x1DC0 && cp <= 0x1DFF) ||
           (cp >= 0x20D0 && cp <= 0x20FF) ||
           (cp >= 0xFE20 && cp <= 0xFE2F);
}

bool is_emoji(unsigned cp) {
    return (cp >= 0x1F000 && cp <= 0x1FAFF) ||
           (cp >= 0x2600 && cp <= 0x27BF) ||
           cp == 0x00A9 || cp == 0x00AE || cp == 0x203C || cp == 0x2049 ||
           cp == 0x2122 || cp == 0x2139 || cp == 0x3030 || cp == 0x303D ||
           cp == 0x3297 || cp == 0x3299;
}

bool decode_cp(std::string_view sv, size_t pos, unsigned& cp, size_t& len) {
    if (pos >= sv.size()) return false;
    unsigned char c = static_cast<unsigned char>(sv[pos]);
    if (c < 0x80) {
        len = 1;
        cp = c;
        return true;
    }
    unsigned char lo = 0x80, hi = 0xBF;
    if (c >= 0xC2 && c <= 0xDF) {
        len = 2;
    } else if (c >= 0xE0 && c <= 0xEF) {
        len = 3;
        if (c == 0xE0) lo = 0xA0;
        else if (c == 0xED) hi = 0x9F;
    } else if (c >= 0xF0 && c <= 0xF4) {
        len = 4;
        if (c == 0xF0) lo = 0x90;
        else if (c == 0xF4) hi = 0x8F;
    } else {
        return false;
    }
    if (pos + len > sv.size()) return false;
    for (size_t j = 1; j < len; ++j) {
        unsigned char cc = static_cast<unsigned char>(sv[pos + j]);
        if (j == 1) {
            if (cc < lo || cc > hi) return false;
        } else if (cc < 0x80 || cc > 0xBF) {
            return false;
        }
    }
    if (len == 2) {
        cp = (static_cast<unsigned>(c & 0x1F) << 6) |
             (static_cast<unsigned char>(sv[pos + 1]) & 0x3F);
    } else if (len == 3) {
        cp = (static_cast<unsigned>(c & 0x0F) << 12) |
             ((static_cast<unsigned char>(sv[pos + 1]) & 0x3F) << 6) |
             (static_cast<unsigned char>(sv[pos + 2]) & 0x3F);
    } else {
        cp = (static_cast<unsigned>(c & 0x07) << 18) |
             ((static_cast<unsigned char>(sv[pos + 1]) & 0x3F) << 12) |
             ((static_cast<unsigned char>(sv[pos + 2]) & 0x3F) << 6) |
             (static_cast<unsigned char>(sv[pos + 3]) & 0x3F);
    }
    return true;
}

bool valid_name(std::string_view sv) {
    size_t chars = 0;
    size_t i = 0;
    bool prev_emoji = false;
    while (i < sv.size()) {
        unsigned cp;
        size_t len;
        if (!decode_cp(sv, i, cp, len)) return false;

        if (cp == 0x200D) {
            unsigned next_cp;
            size_t next_len;
            if (!prev_emoji || !decode_cp(sv, i + len, next_cp, next_len) || !is_emoji(next_cp)) {
                return false;
            }
        } else {
            if (forbidden_codepoint(cp)) return false;
            if (is_combining_mark(cp)) {
                if (chars == 0) return false;
            } else if (++chars > 40) {
                return false;
            }
        }
        prev_emoji = is_emoji(cp);
        i += len;
    }
    return chars > 0;
}

unsigned collate_rank(unsigned cp) {
    if (cp == 0x0401) return 0x0415u * 2u + 1u;
    if (cp == 0x0451) return 0x0435u * 2u + 1u;
    return cp * 2u;
}

bool name_less(std::string_view a, std::string_view b) {
    size_t i = 0, j = 0;
    while (i < a.size() && j < b.size()) {
        unsigned ca, cb;
        size_t la, lb;
        if (!decode_cp(a, i, ca, la) || !decode_cp(b, j, cb, lb)) return a < b;
        unsigned ra = collate_rank(ca), rb = collate_rank(cb);
        if (ra != rb) return ra < rb;
        i += la;
        j += lb;
    }
    return i == a.size() && j != b.size();
}

bool next_line(std::string_view& data, std::string_view& line) {
    if (data.empty()) return false;
    size_t pos = data.find('\n');
    if (pos == std::string_view::npos) {
        line = data;
        data = std::string_view();
    } else {
        line = data.substr(0, pos);
        data.remove_prefix(pos + 1);
    }
    if (!line.empty() && line.back() == '\r') {
        line.remove_suffix(1);
    }
    return true;
}

static int run() {
#ifdef D_DEBUG
    auto start = std::chrono::steady_clock::now();
#endif
    {
        FILE* cf = std::fopen("output.txt", "wb");
        if (!cf) return 0;
        std::fclose(cf);
    }

    FILE* in = std::fopen("input.txt", "rb");
    if (!in) return 0;

    std::fseek(in, 0, SEEK_END);
    long fsize = std::ftell(in);
    if (fsize <= 0) {
        std::fclose(in);
        return 0;
    }
    std::fseek(in, 0, SEEK_SET);

    size_t file_bytes = static_cast<size_t>(fsize);
    Arena arena(file_bytes * 2 + 1024 * 1024);

    char* raw_buf = static_cast<char*>(arena.allocate(file_bytes + 1, 8));
    if (std::fread(raw_buf, 1, file_bytes, in) != file_bytes) {
        std::fclose(in);
        return 0;
    }
    std::fclose(in);
    raw_buf[file_bytes] = '\0';

    if (std::memchr(raw_buf, '\0', file_bytes) != nullptr) return 0;

    std::string_view cursor(raw_buf, file_bytes);
    if (cursor.size() >= 3 && static_cast<unsigned char>(cursor[0]) == 0xEF &&
        static_cast<unsigned char>(cursor[1]) == 0xBB && static_cast<unsigned char>(cursor[2]) == 0xBF) {
        cursor.remove_prefix(3);  // UTF-8 BOM (Блокнот Windows)
    }
    std::string_view line;

    if (!next_line(cursor, line)) return 0;
    int n = 0;
    if (!parse_int_fast(line, n) || n < 0) return 0;

    double threshold = 0.0;
    if (next_line(cursor, line)) {
        if (!parse_double_fast(line, threshold)) return 0;
    } else if (n != 0) {
        return 0;
    }

    if (static_cast<size_t>(n) > file_bytes / 6 + 1) return 0;

    std::vector<Student, ArenaAllocator<Student>> students{ArenaAllocator<Student>(&arena)};
    students.reserve(static_cast<size_t>(n));

    for (int i = 0; i < n; ++i) {
        if (!next_line(cursor, line)) return 0;

        size_t p1 = line.find(';');
        if (p1 == std::string_view::npos) return 0;
        size_t p2 = line.find(';', p1 + 1);
        if (p2 == std::string_view::npos) return 0;
        size_t p3 = line.find(';', p2 + 1);
        if (p3 == std::string_view::npos) return 0;
        if (line.find(';', p3 + 1) != std::string_view::npos) return 0;

        std::string_view name_sv = line.substr(0, p1);
        if (!valid_name(name_sv)) return 0;

        int group = 0, missed = 0;
        double gpa = 0.0;
        if (!parse_int_fast(line.substr(p1 + 1, p2 - p1 - 1), group) || group < 0) return 0;
        if (!parse_double_fast(line.substr(p2 + 1, p3 - p2 - 1), gpa) || gpa < 0.0 || gpa > 10.0) return 0;
        if (!parse_int_fast(line.substr(p3 + 1), missed) || missed < 0) return 0;

        if (gpa == 0.0) gpa = 0.0;  // убираем отрицательный ноль
        if (gpa > threshold) {
            students.push_back(Student{name_sv, group, gpa, missed});
        }
    }

    if (!cursor.empty()) return 0;

    std::stable_sort(students.begin(), students.end(), [](const Student& a, const Student& b) {
        if (a.gpa != b.gpa) return a.gpa > b.gpa;
        return name_less(a.full_name, b.full_name);
    });

    FILE* out = std::fopen("output.txt", "wb");
    if (!out) return 0;

    std::string out_chunk;
    out_chunk.reserve(1024 * 1024);

    char num_buf[512];  // %.2f от DBL_MAX ~ 310 символов
    int len = std::snprintf(num_buf, sizeof(num_buf), "%zu\n", students.size());
    out_chunk.append(num_buf, static_cast<size_t>(len));

    for (const auto& s : students) {
        out_chunk.append(s.full_name.data(), s.full_name.size());
        len = std::snprintf(num_buf, sizeof(num_buf), ";%d;%.2f;%d\n", s.group, s.gpa, s.missed);
        if (len < 0 || static_cast<size_t>(len) >= sizeof(num_buf)) {
            std::fclose(out);
            FILE* t = std::fopen("output.txt", "wb");  // обнуляем частично записанный вывод
            if (t) std::fclose(t);
            return 0;
        }
        out_chunk.append(num_buf, static_cast<size_t>(len));

        if (out_chunk.size() >= 900 * 1024) {
            std::fwrite(out_chunk.data(), 1, out_chunk.size(), out);
            out_chunk.clear();
        }
    }
    if (!out_chunk.empty()) {
        std::fwrite(out_chunk.data(), 1, out_chunk.size(), out);
    }

    std::fclose(out);

#ifdef D_DEBUG
    auto end = std::chrono::steady_clock::now();
    std::cout << "time: " << std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count() << "ms\n";
#endif
    return 0;
}

int main() {
    try {
        return run();
    } catch (...) {
        // output.txt уже создан пустым в начале run()
        return 0;
    }
}
