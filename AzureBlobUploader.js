class AzureBlobUploaderPrivate {
    constructor() {
        this.uploadUrl = null
        this.maxBlockSize = 256 * 1024 // Each file will be split into 256KB chunks
        this.numberOfBlocks = 1
        this.currentFilePointer = 0
        this.totalBytesRemaining = 0
        this.blockIds = []
        this.blockIdPrefix = 'block-'
        this.bytesUploaded = 0
        this.selectedFile = null
        this.reader = null
        this.onprogress = null
        this.cancelled = false
        this.resolve = null
        this.reject = null
    }

    cancel() {
        this.cancelled = true
    }

    upload(uploadUrl, file) {
        return new Promise((resolve, reject) => {
            this.resolve = resolve
            this.reject = reject
            this.uploadUrl = uploadUrl
            this.selectedFile = file
            const fileSize = this.selectedFile.size
            if (fileSize < this.maxBlockSize) {
                this.maxBlockSize = fileSize
            }
            this.totalBytesRemaining = fileSize
            if (fileSize % this.maxBlockSize === 0) {
                this.numberOfBlocks = fileSize / this.maxBlockSize
            } else {
                this.numberOfBlocks = parseInt(fileSize / this.maxBlockSize, 10) + 1
            }

            this.reader = new FileReader()
            this.reader.onloadend = (evt) => {
                if (evt.target.readyState === FileReader.DONE) {
                    const uri = `${this.uploadUrl}&comp=block&blockid=${this.blockIds[this.blockIds.length - 1]}`
                    const requestData = new Uint8Array(evt.target.result)
                    const xhr = new XMLHttpRequest()
                    xhr.addEventListener('load', () => {
                        if (this.cancelled) {
                            this.reject(new Error('file upload canceled'))
                            return
                        }
                        this.bytesUploaded += requestData.length
                        const fraction = (
                            parseFloat(this.bytesUploaded) / parseFloat(this.selectedFile.size)
                        )
                        const percentComplete = (fraction * 100).toFixed(2)
                        if (this.onprogress) {
                            this.onprogress(percentComplete, this)
                        }
                        this.uploadFileInBlocks()
                    }, false)
                    xhr.open('PUT', uri, true)
                    xhr.setRequestHeader('x-ms-blob-type', 'BlockBlob')
                    xhr.send(requestData.buffer)
                }
            }
            this.uploadFileInBlocks()
        })
    }

    uploadFileInBlocks() {
        if (this.totalBytesRemaining > 0) {
            const fileContent = (
                this.selectedFile.slice(
                    this.currentFilePointer,
                    this.currentFilePointer + this.maxBlockSize
                )
            )
            const blockId = this.blockIdPrefix + this.blockIds.length.toString().padStart(6, '0')
            this.blockIds.push(btoa(blockId))
            this.reader.readAsArrayBuffer(fileContent)
            this.currentFilePointer += this.maxBlockSize
            this.totalBytesRemaining -= this.maxBlockSize
            if (this.totalBytesRemaining < this.maxBlockSize) {
                this.maxBlockSize = this.totalBytesRemaining
            }
        } else {
            this.commitBlockList()
        }
    }

    commitBlockList() {
        const uri = `${this.uploadUrl}&comp=blocklist`
        let requestBody = '<?xml version="1.0" encoding="utf-8"?><BlockList>'
        for (let i = 0; i < this.blockIds.length; i += 1) {
            requestBody = `${requestBody}<Latest>${this.blockIds[i]}</Latest>`
        }
        requestBody = `${requestBody}</BlockList>`

        const xhr = new XMLHttpRequest()
        xhr.addEventListener('load', () => {
            this.resolve()
        }, false)
        xhr.open('PUT', uri, true)
        xhr.setRequestHeader('x-ms-blob-content-type', this.selectedFile.type)
        xhr.send(requestBody)
    }
}

export default class AzureBlobUploader {
    constructor() {
        this._uploader = null
        this.cancelled = false
    }
    upload(uploadUrl, file, onProgress) {
        if (this._uploader) {
            return Promise.reject(new Error('Uploader can only be used once'))
        }
        if (this.cancelled) {
            return Promise.reject(new Error('file upload canceled'))
        }
        this._uploader = new AzureBlobUploaderPrivate()
        this._uploader.onprogress = onProgress
        return this._uploader.upload(uploadUrl, file)
    }
    cancel() {
        if (this._uploader) {
            this._uploader.cancel()
            this.cancelled = true
        }
    }
}
