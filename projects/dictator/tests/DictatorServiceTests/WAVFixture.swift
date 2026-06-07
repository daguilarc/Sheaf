import Foundation

enum WAVFixture
{
    static func makeMonoPCM16(sampleRate: Int, frameCount: Int = 160) -> Data
    {
        var data = Data()
        data.append(contentsOf: [0x52, 0x49, 0x46, 0x46])
        let pcmByteCount = frameCount * 2
        let riffSize = UInt32(36 + pcmByteCount)
        data.append(contentsOf: withUnsafeBytes(of: riffSize.littleEndian) { Array($0) })
        data.append(contentsOf: [0x57, 0x41, 0x56, 0x45])
        data.append(contentsOf: [0x66, 0x6D, 0x74, 0x20])
        data.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: UInt32(sampleRate).littleEndian) { Array($0) })
        let byteRate = UInt32(sampleRate * 2)
        data.append(contentsOf: withUnsafeBytes(of: byteRate.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: UInt16(2).littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: UInt16(16).littleEndian) { Array($0) })
        data.append(contentsOf: [0x64, 0x61, 0x74, 0x61])
        data.append(contentsOf: withUnsafeBytes(of: UInt32(pcmByteCount).littleEndian) { Array($0) })
        data.append(Data(repeating: 0, count: pcmByteCount))
        return data
    }

    static func makeInvalidHeader(sampleRate: Int) -> Data
    {
        var data = makeMonoPCM16(sampleRate: sampleRate)
        data[0] = 0x00
        return data
    }

    static func makeMismatchedHeaderRate(headerRate: Int, wavRate: Int) -> Data
    {
        makeMonoPCM16(sampleRate: wavRate)
    }
}
