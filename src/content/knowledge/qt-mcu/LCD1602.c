#include <REGX52.H>
// 引脚配置：
sbit LCD_RS = P2 ^ 6;
sbit LCD_RW = P2 ^ 5;
sbit LCD_EN = P2 ^ 7;
#define LCD_DataPort P0
// 函数定义：
/**
 * @brief  LCD1602延时函数，12MHz调用可延时1ms
 * @param  无
 * @retval 无
 */
void LCD_Delay() {
  unsigned char i, j;
  i = 2;
  j = 239;
  do {
    while (--j)
      ;
  } while (--i);
}
/**
 * @brief  LCD1602写命令
 * @param  Command 要写入的命令
 * @retval 无
 */
void LCD_WriteCommand(unsigned char Command) {
  LCD_RS = 0;
  LCD_RW = 0;
  LCD_DataPort = Command;
  LCD_EN = 1;
  LCD_Delay();
  LCD_EN = 0;
  LCD_Delay();
}
/**
 * @brief  LCD1602写数据
 * @param  Data 要写入的数据
 * @retval 无
 */
void LCD_WriteData(unsigned char Data) {
  LCD_RS = 1;
  LCD_RW = 0;
  LCD_DataPort = Data;
  LCD_EN = 1;
  LCD_Delay();
  LCD_EN = 0;
  LCD_Delay();
}
/**
 * @brief  LCD1602设置光标位置
 * @param  Line 行位置，范围：1~2
 * @param  Column 列位置，范围：1~16
 * @retval 无
 */
void LCD_SetCursor(unsigned char Line, unsigned char Column) {
  if (Line == 1) {
    LCD_WriteCommand(0x80 | (Column - 1));
  } else if (Line == 2) {
    LCD_WriteCommand(0x80 | (Column - 1 + 0x40));
  }
}
/**
 * @brief  LCD1602初始化函数
 * @param  无
 * @retval 无
 */
void LCD_Init() {
  LCD_WriteCommand(0x38); // 八位数据接口，两行显示，5*7点阵
  LCD_WriteCommand(0x0c); // 显示开，光标关，闪烁关
  LCD_WriteCommand(0x06); // 数据读写操作后，光标自动加一，画面不动
  LCD_WriteCommand(0x01); // 光标复位，清屏
}
/**
 * @brief  在LCD1602指定位置上显示一个字符
 * @param  Line 行位置，范围：1~2
 * @param  Column 列位置，范围：1~16
 * @param  Char 要显示的字符
 * @retval 无
 */
void LCD_ShowChar(unsigned char Line, unsigned char Column, char Char) {
  LCD_SetCursor(Line, Column);
  LCD_WriteData(Char);
}
/**
 * @brief  在LCD1602指定位置开始显示所给字符串
 * @param  Line 起始行位置，范围：1~2
 * @param  Column 起始列位置，范围：1~16
 * @param  String 要显示的字符串
 * @retval 无
 */
void LCD_ShowString(unsigned char Line, unsigned char Column, char *String) {
  unsigned char i;
  LCD_SetCursor(Line, Column);
  for (i = 0; String[i] != '\0'; i++) {
    LCD_WriteData(String[i]);
  }
}
/**
 * @brief  返回值=X的Y次方
 */
int LCD_Pow(int X, int Y) {
  unsigned char i;
  int Result = 1;
  for (i = 0; i < Y; i++) {
    Result *= X;
  }
  return Result;
}
/**
 * @brief  在LCD1602指定位置开始显示所给数字
 * @param  Line 起始行位置，范围：1~2
 * @param  Column 起始列位置，范围：1~16
 * @param  Number 要显示的数字，范围：0~65535
 * @param  Length 要显示数字的长度，范围：1~5
 * @retval 无
 */
void LCD_ShowNum(unsigned char Line, unsigned char Column, unsigned int Number,
                 unsigned char Length) {
  unsigned char i;
  LCD_SetCursor(Line, Column);
  for (i = Length; i > 0; i--) {
    LCD_WriteData(Number / LCD_Pow(10, i - 1) % 10 + '0');
  }
}
/**
 * @brief  在LCD1602指定位置开始以有符号十进制显示所给数字
 * @param  Line 起始行位置，范围：1~2
 * @param  Column 起始列位置，范围：1~16
 * @param  Number 要显示的数字，范围：-32768~32767
 * @param  Length 要显示数字的长度，范围：1~5
 * @retval 无
 */
void LCD_ShowSignedNum(unsigned char Line, unsigned char Column, int Number,
                       unsigned char Length) {
  unsigned char i;
  unsigned int Number1;
  LCD_SetCursor(Line, Column);
  if (Number >= 0) {
    LCD_WriteData('+');
    Number1 = Number;
  } else {
    LCD_WriteData('-');
    Number1 = -Number;
  }
  for (i = Length; i > 0; i--) {
    LCD_WriteData(Number1 / LCD_Pow(10, i - 1) % 10 + '0');
  }
}
/**
 * @brief  在LCD1602指定位置开始以十六进制显示所给数字
 * @param  Line 起始行位置，范围：1~2
 * @param  Column 起始列位置，范围：1~16
 * @param  Number 要显示的数字，范围：0~0xFFFF
 * @param  Length 要显示数字的长度，范围：1~4
 * @retval 无
 */
void LCD_ShowHexNum(unsigned char Line, unsigned char Column,
                    unsigned int Number, unsigned char Length) {
  unsigned char i, SingleNumber;
  LCD_SetCursor(Line, Column);
  for (i = Length; i > 0; i--) {
    SingleNumber = Number / LCD_Pow(16, i - 1) % 16;
    if (SingleNumber < 10) {
      LCD_WriteData(SingleNumber + '0');
    } else {
      LCD_WriteData(SingleNumber - 10 + 'A');
    }
  }
}
/**
 * @brief  在LCD1602指定位置开始以二进制显示所给数字
 * @param  Line 起始行位置，范围：1~2
 * @param  Column 起始列位置，范围：1~16
 * @param  Number 要显示的数字，范围：0~1111 1111 1111 1111
 * @param  Length 要显示数字的长度，范围：1~16
 * @retval 无
 */
void LCD_ShowBinNum(unsigned char Line, unsigned char Column,
                    unsigned int Number, unsigned char Length) {
  unsigned char i;
  LCD_SetCursor(Line, Column);
  for (i = Length; i > 0; i--) {
    LCD_WriteData(Number / LCD_Pow(2, i - 1) % 2 + '0');
  }
}

//===================== 串口部分 =====================
typedef unsigned char u8;
u8 char_index = 0; // 记录当前字符位置

void UART_Init(u8 baud) {
  TMOD |= 0X20; // 定时器1，模式2
  SCON = 0X50;  // 串口模式1，允许接收
  PCON |= 0X80; // SMOD=1，波特率加倍
  TH1 = baud;
  TL1 = baud;
  ES = 1;  // 串口中断使能
  EA = 1;  // 总中断
  TR1 = 1; // 启动定时器1
}

// 串口中断服务函数
void UART_ISR() interrupt 4 {
  u8 rec_dat;
  if (RI) {
    RI = 0;
    rec_dat = SBUF;
    SBUF = rec_dat; // 串口回显，发送什么串口助手收到什么

    // 收到回车字符 \r，清屏，光标回到第一行第1列
    if (rec_dat == '\r') {
      LCD_WriteCommand(0x01); // 清屏
      char_index = 0;
      LCD_SetCursor(1, 1);
    } else {
      // 一行最多16个字符，满了从头覆盖
      if (char_index >= 16) {
        char_index = 0;
        LCD_SetCursor(1, 1);
      }
      LCD_ShowChar(1, char_index + 1, rec_dat);
      char_index++;
    }
  }
  if (TI) {
    TI = 0;
  }
}

void main(void) {
  LCD_Init();
  LCD_ShowString(1, 1, "UART->LCD");
  LCD_ShowString(2, 1, "Input:");
  UART_Init(0XFA); // 0xFA = 250，9600波特率，11.0592MHz晶振
  while (1) {
  }
}
