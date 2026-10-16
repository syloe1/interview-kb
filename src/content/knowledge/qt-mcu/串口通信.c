#include "reg52.h"
typedef unsigned int u16;
typedef unsigned char u8;

void uart_init(u8 baud) {
  TMOD |= 0X20; // 定时器1，模式2 8位自动重装
  SCON = 0X50;  // 串口模式1，允许接收 REN=1
  PCON = 0X80;  // SMOD=1，波特率加倍
  TH1 = baud;
  TL1 = baud;
  ES = 1;  // 串口中断使能
  EA = 1;  // 总中断
  TR1 = 1; // 启动定时器1
}

void main() {
  uart_init(0XFA); // 0xFA = 250
  while (1) {
  }
}

void uart() interrupt 4 {
  u8 rec_data;
  RI = 0;          // 清接收标志
  rec_data = SBUF; // 读取收到字节
  SBUF = rec_data; // 回发（echo 回显）
  while (!TI)
    ;     // 等待发送完成
  TI = 0; // 清发送标志
}
