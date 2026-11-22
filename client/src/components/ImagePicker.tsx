import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export function ImagePicker({
  files,
  onChange,
  disabled = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  const pick = (incoming: FileList | null) => {
    if (!incoming) return;
    const list = Array.from(incoming);
    const errors: string[] = [];
    const accepted: File[] = [];

    for (const file of list) {
      const name = file.name.toLowerCase();
      if (name.endsWith('.heic') || name.endsWith('.heif') || /heic|heif/.test(file.type)) {
        errors.push(`${file.name}：HEIC 格式浏览器无法预览，请先转成 jpg`);
        continue;
      }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        errors.push(`${file.name}：仅支持 jpg / jpeg / png / webp`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        errors.push(`${file.name}：单张不能超过 10MB`);
        continue;
      }
      accepted.push(file);
    }

    const merged = [...files, ...accepted];
    if (merged.length > 9) {
      errors.push('一条案例最多上传 9 张图片');
      return setError(errors.join('；'));
    }

    setError(errors.join('；'));
    onChange(merged);
  };

  return (
    <div>
      <label
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-5 text-center transition-colors ${
          disabled ? 'cursor-not-allowed opacity-60' : 'border-line hover:border-accent hover:bg-accent-soft/40'
        }`}
      >
        <Icon name="upload" className="h-6 w-6 text-accent" />
        <span className="text-[12.5px] text-ink">点击选择现场照片（可多选）</span>
        <span className="text-[10.5px] text-muted">jpg / png / webp · 单张 ≤ 10MB · 最多 9 张</span>
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.heic,.heif"
          className="hidden"
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files);
            e.target.value = '';
          }}
        />
      </label>

      {error && <p className="mb-0 mt-2 text-[11.5px] leading-[1.7] text-bad">{error}</p>}

      {files.length > 0 && (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {files.map((file, index) => (
            <div key={`${file.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg border border-line">
              <img src={previews[index]} alt={file.name} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                disabled={disabled}
                className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-graphite/80 text-white"
                title="移除"
              >
                <Icon name="close" className="h-3.5 w-3.5" />
              </button>
              <div className="absolute inset-x-0 bottom-0 truncate bg-graphite/75 px-1.5 py-1 text-[9.5px] text-white">
                {file.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
