#include "reg52.h"
typedef unsigned int u16;

sbit K4 = P3 ^ 3;

void delay_ms(u16 ms) {
  u16 i, j;
  for (i = ms; i > 0; i--)
    for (j = 110; j > 0; j--)
      ;
}

bit led_flag = 1; // 1熄灭，0点亮

void int1_isr(void) interrupt 2 {
  delay_ms(10);
  if (K4 == 0) {
    led_flag = !led_flag;
    if (led_flag)
      P2 = 0xFF; // 全部LED熄灭
    else
      P2 = 0x00; // 全部LED点亮
  }
  while (K4 == 0)
    ;
}

void main(void) {
  P2 = 0xFF; // 上电全部熄灭
  IT1 = 1;   // 外部中断1的触发方式 边沿触发
  EX1 = 1;   // 外部中断1的单独开关 开启中部中断1
  EA = 1;    // 打开中断总开关
  while (1)
    ;
}
