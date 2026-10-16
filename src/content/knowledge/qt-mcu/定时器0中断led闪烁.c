#include "reg52.h"
typedef unsigned int u16;
typedef unsigned char u8;

u16 count = 0;    // 中断计数器
bit led_flag = 1; // 1熄灭，0点亮

// 定时器0初始化
void Timer0_Init(void) {
  TMOD |= 0x01; // Timer0 模式1：16位定时器
  // 11.0592MHz，定时50ms溢出一次
  TH0 = 0x4C; // 定时器0高8位
  TL0 = 0x00; // 定时器0低8位
  ET0 = 1;    // 定时器0中断使能
  TR0 = 1;    // 启动定时器0
  EA = 1;     // 总中断打开
}

// 定时器0中断服务函数 interrupt 1
void Timer0_ISR(void) interrupt 1 {
  TH0 = 0x4C; // 重装初值，模式1不会自动重装！必须手动写
  TL0 = 0x00;
  count++;         // 每50ms进一次中断，count+1
  if (count >= 20) // 20 * 50ms = 1000ms = 1s
  {
    count = 0;            // 计数器清零
    led_flag = !led_flag; // 翻转标志
    if (led_flag)
      P2 = 0xFF; // 全灭
    else
      P2 = 0x00; // 全亮
  }
}

void main(void) {
  P2 = 0xFF;
  count = 0;
  Timer0_Init();
  while (1) {
    // 主循环啥都不用写，闪烁全部交给定时器中断
  }
}
