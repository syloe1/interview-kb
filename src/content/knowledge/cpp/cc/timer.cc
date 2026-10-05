#include <iostream>
#include <ctime>
#include <unistd.h>
using namespace std; 
class Timer {
    using Callback = void(void*);
    Timer(int time, Callback cb) : time(time_), cb(cb_) {}
    void start() {
        time_t st = time(nullptr);
        time_t ed = st + time;
        while(time(nullptr) < ed) {
            sleep(1);
        }
        cout<<"定时器结束"
    }
    private:
        Callback cb_;
        time_t time_;
};
void F() {
    cout<<"定时器启动"；
}
int main() {
    Timer c(5, F);
    cout<<"St................";
    return 0;
}
