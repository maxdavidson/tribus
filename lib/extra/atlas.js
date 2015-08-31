export class Atlas {

    constructor({ maxSize = 10, initialSize = 0 } = {}) {
        this.regions = [new Region(0, 0, 1 << initialSize, 1 << initialSize)];

        // Powers of 2
        this.maxSize = maxSize;
    }

    static imageComparator(a, b) {
        return Atlas.getImageSize(b) - Atlas.getImageSize(a);
    }

    static getImageSize(image) {
        return Math.max(image.width, image.height);
    }

    static getFittingSize(image) {
        return Math.ceil(Math.log2(Atlas.getImageSize(image)));
    }

    // Needs to signal what subregions changed, in what major region
    // Either it inserts successfully, returning the region
    // Or resets the entire state
    insert(image) {
        // Try insert into each available region

        if (Atlas.getFittingSize(image) > this.maxSize) {
            return [Atlas.FAILED, 'Image size is too large!'];
        }

        let subregion;
        for (let i = 0, len = this.regions.length; i < len; ++i) {
            subregion = this.regions[i].insert(image);
            if (subregion) {
                return [Atlas.SUCCESS, i, subregion];
            }
        }

        const images = [image];
        for (let region of this.regions) {
            for (let img of region.images()) {
                images.push(img);
            }
        }
        images.sort(Atlas.imageComparator);

        let size = Atlas.getFittingSize(images[0]);

        this.regions.length = 1;

        loop: while (true) {

            // Reset all regions except last one to max size
            for (let i = 0; i < this.regions.length - 1; ++i) {
                this.regions[i] = new Region(0, 0, 1 << this.maxSize, 1 << this.maxSize);
            }
            // Reset last region to current size
            this.regions[this.regions.length - 1] = new Region(0, 0, 1 << size, 1 << size);

            let currentRegion = 0;

            let region = this.regions[currentRegion];

            // Try to insert all images
            for (let img of images) {

                // Check if insertion failed
                if (!region.insert(img)) {
                    // Increase size of last region
                    size++;

                    if (size <= this.maxSize) {
                        // Try inserting everything again
                        continue loop
                    } else {
                        // Select next region
                        region = this.regions[++currentRegion];

                        if (!region) {
                            size = Atlas.getFittingSize(img);
                            region = this.regions[currentRegion] = new Region(0, 0, 1 << size, 1 << size);
                        }

                        region.insert(img);
                    }
                }
            }

            // All insertions successful
            break;
        }

        return [Atlas.RESET];
    }
}

Atlas.FAILED = 0;
Atlas.SUCCESS = 1;
Atlas.RESET = 2;


export class Region {

    get outerWidth() { return this.right - this.left; }
    get outerHeight() { return this.bottom - this.top; }

    get innerWidth() { return this.image.width; }
    get innerHeight() { return this.image.height; }

    get isFilled() { return this.image !== null; }

    toString() {
        return `${this.constructor.name}(${this.left}, ${this.top}, ${this.right}, ${this.bottom})`;
    }

    constructor(left = 0, top = 0, right = 0, bottom = 0) {
        this.left = left;
        this.top = top;
        this.right = right;
        this.bottom = bottom;

        this.image = null;

        this.downRegion = null;
        this.rightRegion = null;
    }

    *images() { for (let region of this) yield region.image; }

    *[Symbol.iterator]() {
        if (this.isFilled) {
            yield this;
            yield* this.downRegion;
            yield* this.rightRegion;
        }
    }

    /**
     * Recursively subdivide into smaller regions.
     * Returns the subregion if insertion was successful, otherwise undefined.
     */
    insert(image) {
        // region is filled, search deeper for space
        if (this.isFilled) {
            return (this.image === image) ? this : this.downRegion.insert(image) || this.rightRegion.insert(image);
        }

        // doesn't fit
        if (image.height > this.outerHeight || image.width > this.outerWidth) {
            return undefined;
        }

        // success, store image and split
        this.image = image;

        const dw = this.outerWidth - this.innerWidth; // Horizontal available space
        const dh = this.outerHeight - this.innerHeight; // Vertical available space

        // Split in the direction of most available space
        if (dw > dh) {
            this.downRegion = new Region(this.left, this.top + this.innerHeight, this.right, this.bottom);
            this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.top + this.innerHeight);
        } else {
            this.downRegion = new Region(this.left, this.top + this.innerHeight, this.left + this.innerWidth, this.bottom);
            this.rightRegion = new Region(this.left + this.innerWidth, this.top, this.right, this.bottom);
        }

        return this;
    }
}

