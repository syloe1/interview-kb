#include <reg52.h>
typedef unsigned int u16;
typedef unsigned char u8;

// 八拍节拍表
u8 code step_table[8] = {0x01, 0x03, 0x02, 0x06, 0x04, 0x0C, 0x08, 0x09};

void delay_ms(u16 ms) {
  u16 i, j;
  for (i = ms; i > 0; i--)
    for (j = 110; j > 0; j--)
      ;
}

// 转动 N 个八拍循环
void motor_step(u16 cycle_cnt) {
  u8 i;
  u16 c;
  for (c = 0; c < cycle_cnt; c++) {
    for (i = 0; i < 8; i++) {
      P1 = step_table[i];
      delay_ms(2); // 每一拍延时，控制转速，越大越慢
    }
  }
  P1 = 0x00; // 全部线圈断电，释放电机
}

void main(void) {
  while (1) {
    motor_step(120); // 持续输出120组八拍，转动3秒左右
    delay_ms(9000);  // 停止3秒，电机完全不动
    motor_step(120); // 再转动3秒左右
    delay_ms(3000);  // 停止3秒
  }
}
