import { cn } from "@/lib/utils";

interface ImageAttachmentProps {
  imageUrl: string;
  caption?: string;
  isBot: boolean;
}

export default function ImageAttachment({ imageUrl, caption, isBot }: ImageAttachmentProps) {
  const handleClick = () => {
    window.open(imageUrl, '_blank');
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 max-w-sm cursor-pointer",
        isBot ? "items-end" : "items-start"
      )}
      onClick={handleClick}
    >
      <div className={cn(
        "rounded-lg overflow-hidden border-2 hover:opacity-90 transition-opacity",
        isBot ? "border-primary/20" : "border-muted-foreground/20"
      )}>
        <img
          src={imageUrl}
          alt={caption || "Image"}
          className="w-full h-auto object-cover max-h-96"
          loading="lazy"
        />
      </div>
      {caption && (
        <p className={cn(
          "text-xs px-2",
          isBot ? "text-primary-foreground/80" : "text-muted-foreground"
        )}>
          {caption}
        </p>
      )}
    </div>
  );
}
