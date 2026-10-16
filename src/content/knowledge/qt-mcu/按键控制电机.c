#include <reg52.h>
typedef unsigned int u16;
typedef unsigned char u8;

sbit K1 = P3 ^ 0; // K1按键

// 八拍节拍表
u8 code step_table[8] = {0x01, 0x03, 0x02, 0x06, 0x04, 0x0C, 0x08, 0x09};
u8 run_flag = 0; // 0停止，1运行
u8 step_idx = 0; // 当前走到第几拍

void delay_ms(u16 ms) {
  u16 i, j;
  for (i = ms; i > 0; i--)
    for (j = 110; j > 0; j--)
      ;
}

void key_scan(void) {
  if (K1 == 0) {
    delay_ms(10); // 消抖
    if (K1 == 0) {
      while (K1 == 0)
        ;                   // 等待按键松开
      run_flag = !run_flag; // 翻转启停标记
      if (run_flag == 0) {
        P1 = 0x00;
      }
    }
  }
}

void main(void) {
  P1 = 0x00; // 【重点】上电立刻关闭电机所有相
  delay_ms(100); // 【重点】上电等待100ms，电源稳定，防止按键上电误触发
  step_idx = 0;
  run_flag = 0;

  while (1) {
    key_scan();
    if (run_flag == 1) {
      P1 = step_table[step_idx]; // 输出当前这一拍
      delay_ms(5);
      step_idx++;
      if (step_idx >= 8) {
        step_idx = 0; // 8拍跑完从头循环
      }
    } else {
      // run_flag=0，不输出节拍
    }
  }
}
