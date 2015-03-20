export function getString(url: string): Promise<string> {
    return ajax(url);
}

export function getJson(url: string): Promise<Object> {
    return ajax(url, { responseType: 'json' });
}

export function getArrayBuffer(url: string): Promise<ArrayBuffer> {
    return ajax(url, { responseType: 'arraybuffer' });
}

export function ajax(url: string, { responseType = 'text' } = {}): Promise<any> {
    const xhr = new XMLHttpRequest;
    return new Promise((resolve, reject) => {
        xhr.open('GET', url);
        xhr.responseType = responseType;
        xhr.onload = () => {
            if (xhr.status == 200) {
                resolve(xhr.response);
            } else {
                reject(new Error(xhr.statusText));
            }
        };
        xhr.onerror = () => { reject(new Error('Network Error')); };
        xhr.send();
    });
}
