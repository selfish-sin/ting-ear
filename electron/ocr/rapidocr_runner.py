"""
听伴截图 OCR 子进程脚本
用法: python rapidocr_runner.py <image_path>
      python rapidocr_runner.py --preheat   # 只加载模型后退出（预热）

输出: 识别文本（纯文本，按行连接）。失败输出 ERROR: <msg>
"""
import sys
import io

# 强制 stdout 用 utf-8（防止 Windows GBK 编码问题）
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def main():
    if len(sys.argv) < 2:
        print("ERROR: missing image path")
        sys.exit(1)

    image_path = sys.argv[1]

    try:
        # rapidocr_onnxruntime 优先（API 更稳定），其次 rapidocr
        try:
            from rapidocr_onnxruntime import RapidOCR
            engine = RapidOCR()
        except ImportError:
            from rapidocr import RapidOCR
            engine = RapidOCR()

        # 预热模式：只加载模型，不识别
        if image_path == '--preheat':
            print("OCR_READY")
            return

        result, _elapsed = engine(image_path)
        if result is None:
            print("")
            return
        # result: List[Tuple(box, text, score)]
        lines = [item[1] for item in result if item and len(item) >= 2]
        print("\n".join(lines))
    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}")
        sys.exit(2)

if __name__ == "__main__":
    main()
