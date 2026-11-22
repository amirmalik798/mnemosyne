import "server-only";

export type ZipStreamEntry = {
  name: string;
  read: () => Promise<Buffer>;
};

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Stream a ZIP archive while loading only one original image at a time. */
export function createZipStream(entries: ZipStreamEntry[]): ReadableStream<Uint8Array> {
  if (entries.length > 0xffff) {
    throw new Error("VALIDATION:This topic contains too many images for one ZIP download.");
  }

  const centralDirectory: Buffer[] = [];
  let localOffset = 0;
  let entryIndex = 0;
  let finished = false;
  const dosTime = 0;
  const dosDate = 0x0021;
  const utf8Flag = 0x0800;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;

      try {
        if (entryIndex < entries.length) {
          const entry = entries[entryIndex];
          const name = Buffer.from(entry.name, "utf8");
          if (name.length > 0xffff) throw new Error("An image filename is too long for the ZIP archive.");

          const data = await entry.read();
          if (data.length > 0xffffffff || localOffset > 0xffffffff) {
            throw new Error("VALIDATION:This topic's image archive is too large for a single ZIP download.");
          }
          const checksum = crc32(data);

          const localHeader = Buffer.alloc(30);
          localHeader.writeUInt32LE(0x04034b50, 0);
          localHeader.writeUInt16LE(20, 4);
          localHeader.writeUInt16LE(utf8Flag, 6);
          localHeader.writeUInt16LE(0, 8);
          localHeader.writeUInt16LE(dosTime, 10);
          localHeader.writeUInt16LE(dosDate, 12);
          localHeader.writeUInt32LE(checksum, 14);
          localHeader.writeUInt32LE(data.length, 18);
          localHeader.writeUInt32LE(data.length, 22);
          localHeader.writeUInt16LE(name.length, 26);
          localHeader.writeUInt16LE(0, 28);

          const centralHeader = Buffer.alloc(46);
          centralHeader.writeUInt32LE(0x02014b50, 0);
          centralHeader.writeUInt16LE(20, 4);
          centralHeader.writeUInt16LE(20, 6);
          centralHeader.writeUInt16LE(utf8Flag, 8);
          centralHeader.writeUInt16LE(0, 10);
          centralHeader.writeUInt16LE(dosTime, 12);
          centralHeader.writeUInt16LE(dosDate, 14);
          centralHeader.writeUInt32LE(checksum, 16);
          centralHeader.writeUInt32LE(data.length, 20);
          centralHeader.writeUInt32LE(data.length, 24);
          centralHeader.writeUInt16LE(name.length, 28);
          centralHeader.writeUInt16LE(0, 30);
          centralHeader.writeUInt16LE(0, 32);
          centralHeader.writeUInt16LE(0, 34);
          centralHeader.writeUInt16LE(0, 36);
          centralHeader.writeUInt32LE(0, 38);
          centralHeader.writeUInt32LE(localOffset, 42);
          centralDirectory.push(centralHeader, name);

          controller.enqueue(localHeader);
          controller.enqueue(name);
          controller.enqueue(data);
          localOffset += localHeader.length + name.length + data.length;
          entryIndex += 1;
          return;
        }

        const centralOffset = localOffset;
        const centralBytes = Buffer.concat(centralDirectory);
        if (centralBytes.length > 0xffffffff || centralOffset > 0xffffffff) {
          throw new Error("VALIDATION:This topic's image archive is too large for a single ZIP download.");
        }

        controller.enqueue(centralBytes);
        const end = Buffer.alloc(22);
        end.writeUInt32LE(0x06054b50, 0);
        end.writeUInt16LE(0, 4);
        end.writeUInt16LE(0, 6);
        end.writeUInt16LE(entries.length, 8);
        end.writeUInt16LE(entries.length, 10);
        end.writeUInt32LE(centralBytes.length, 12);
        end.writeUInt32LE(centralOffset, 16);
        end.writeUInt16LE(0, 20);
        controller.enqueue(end);
        finished = true;
        controller.close();
      } catch (error) {
        finished = true;
        controller.error(error);
      }
    },
  });
}
