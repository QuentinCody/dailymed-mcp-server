/// <reference types="node" />
import {deflateRawSync} from "node:zlib";
import {crc32} from "./archive-zip";
export const setid="9aa7140c-012c-4ea6-866d-4732e915dab6";
export const xml=(version="3",text="A &amp; B")=>`<document xmlns="urn:hl7-org:v3"><id root="1efe378e-fee1-4ae9-8ea5-0fe2265fe2d8"/><setId root="${setid}"/><versionNumber value="${version}"/><effectiveTime value="20120920"/><component><section><code code="34066-1"/><text>${text}</text></section></component></document>`;
/** Synthetic complete ZIP, built independently of the production directory parser. */
export function zip(entries:Record<string,string>) {
  const local:Buffer[]=[];const central:Buffer[]=[];let offset=0;
  for(const [name,text] of Object.entries(entries)){
    const raw=Buffer.from(text);const compressed=deflateRawSync(raw);const filename=Buffer.from(name);const crc=crc32(raw);
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(8,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,compressed);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(8,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(raw.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);
    central.push(directory,filename);offset+=header.length+filename.length+compressed.length;
  }
  const directory=Buffer.concat(central);const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return new Uint8Array(Buffer.concat([...local,directory,end]));
}
