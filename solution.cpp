#include <fstream>

int main() {
    std::ifstream input("input.txt");
    std::ofstream output("output.txt");
    output << "Hello, world!\n";
    return 0;
}
