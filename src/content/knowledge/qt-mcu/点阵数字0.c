#include "reg52.h"
typedef unsigned int u16;
typedef unsigned char u8;

sbit HC_SRCLK = P3 ^ 6;
sbit HC_RCLK = P3 ^ 5;
sbit HC_SER = P3 ^ 4;

#define LEDDZ_COL_PORT P0
// 行码：第0~7行，HC595输出高电平选中该行
u8 ghc595_buf[8] = {0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80};

// 数字0字模：1代表该像素要点亮
u8 disp_buf[8] = {0x38, 0x44, 0x44, 0x44, 0x44, 0x44, 0x38, 0x00};

void delay_10us(u16 ten_us) {
  while (ten_us--)
    ;
}

void delay_ms(u16 ms) {
  u16 i, j;
  for (i = ms; i > 0; i--)
    for (j = 110; j > 0; j--)
      ;
}

void hc595_write_data(u8 dat) {
  u8 i = 0;
  for (i = 0; i < 8; i++) {
    HC_SER = dat >> 7;
    dat <<= 1;
    HC_SRCLK = 0;
    delay_10us(1);
    HC_SRCLK = 1;
    delay_10us(1);
  }
  HC_RCLK = 0;
  delay_10us(1);
  HC_RCLK = 1;
}

void main(void) {
  u8 row;
  while (1) {
    for (row = 0; row < 8; row++) {
      LEDDZ_COL_PORT = 0xFF; // 消隐，关闭所有列，防止鬼影
      hc595_write_data(0x00);
      hc595_write_data(ghc595_buf[row]); // 选中当前扫描行
      LEDDZ_COL_PORT = ~disp_buf[row];   // 取反：显存1 → P0输出0，适配共阳点阵
      delay_ms(1);
    }
  }
}
