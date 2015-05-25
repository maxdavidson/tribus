import { Atlas } from '../lib/extra/atlas';

describe('Atlas', () => {

    let atlas: Atlas;

    beforeEach(() => {
       atlas = new Atlas({ initialSize: 9, maxSize: 12 });
    });

    it('has one region at the initial size when created', () => {
        expect(atlas.regions).to.have.length(1);
        expect(atlas.regions[0].outerWidth).to.equal(1 << 9);
        expect(atlas.regions[0].outerHeight).to.equal(1 << 9);
    });

    it('fails to insert an image too large', () => {
        const image = { width: 5000, height: 5000 };

        const [result, ...data] = atlas.insert(image);

        expect(result).to.equal(Atlas.FAILED);
    });

    it('succeeds to insert an image when space is available', () => {
        const image = { width: 128, height: 128 };

        const [result, ...data] = atlas.insert(image);

        expect(result).to.equal(Atlas.SUCCESS);
    });

    it('succeeds to insert multiple images', () => {
        const imageA = { width: 512, height: 256 };
        const imageB = { width: 256, height: 256 };
        const imageC = { width: 128, height: 128 };

        const [resultA, ...dataA] = atlas.insert(imageA);
        const [resultB, ...dataB] = atlas.insert(imageB);
        const [resultC, ...dataC] = atlas.insert(imageC);

        expect(resultA).to.equal(Atlas.SUCCESS);
        expect(resultB).to.equal(Atlas.SUCCESS);
        expect(resultC).to.equal(Atlas.SUCCESS);

        expect(Array.from(atlas.regions[0].images())).to.have.members([imageA, imageB, imageC]);
    });

    it('succeeds and returns the same subregion if the image is already inserted', () => {
        const image = { width: 512, height: 256 };

        const [resultA, i, subregionA] = atlas.insert(image);
        const [resultB, j, subregionB] = atlas.insert(image);

        expect(resultA).to.equal(Atlas.SUCCESS);
        expect(resultB).to.equal(Atlas.SUCCESS);

        expect(i).to.equal(j);
        expect(subregionA).to.exist.and.to.equal(subregionB);
    });

    it('resizes the region to next power of 2 to fit larger images', () => {
        const image = { width: 768, height: 768 };
        const [result] = atlas.insert(image);

        expect(result).to.equal(Atlas.RESET);
        expect(atlas.regions).to.have.length(1);
        expect(atlas.regions[0].outerWidth).to.equal(1 << 10);
        expect(atlas.regions[0].outerHeight).to.equal(1 << 10);
    });

    it('creates a new region if the images do not fit into one region of the maximum size', () => {
        const imageA = { width: 3000, height: 3000 };
        const [resultA] = atlas.insert(imageA);

        expect(resultA).to.equal(Atlas.RESET);
        expect(atlas.regions).to.have.length(1);
        expect(atlas.regions[0].outerWidth).to.equal(1 << atlas.maxSize);
        expect(atlas.regions[0].outerHeight).to.equal(1 << atlas.maxSize);

        const imageB = { width: 2000, height: 2000 };
        const [resultB] = atlas.insert(imageB);

        expect(resultB).to.equal(Atlas.RESET);
        expect(atlas.regions).to.have.length(2);
        expect(atlas.regions[0].outerWidth).to.equal(1 << atlas.maxSize);
        expect(atlas.regions[0].outerHeight).to.equal(1 << atlas.maxSize);
        expect(atlas.regions[1].outerWidth).to.equal(1 << 11);
        expect(atlas.regions[1].outerHeight).to.equal(1 << 11);
    });

    it('tries a more complicated corner case', () => {
        atlas = new Atlas({ initialSize: 8, maxSize: 8 });

        const imageA = { width: 256, height: 256 };
        const imageB = { width: 128, height: 128 };
        const imageC = { width: 128, height: 128 };
        const imageD = { width: 128, height: 128 };

        for (let image of [imageA, imageB, imageC, imageD]) {
            const [result, ...data] = atlas.insert(image);

            switch (image) {
                case imageA: case imageD:
                    expect(result).to.equal(Atlas.SUCCESS);

                    const [i, subregion] = data;
                    expect(subregion).to.exist;
                    expect(subregion.isFilled).to.be.true;
                    expect(subregion.innerWidth).to.equal(image.width);
                    expect(subregion.innerHeight).to.equal(image.height);
                    break;

                case imageB: case imageC:
                    expect(result).to.equal(Atlas.RESET);

                    expect(atlas.regions).to.have.length(2);
                    expect(Array.from(atlas.regions[0].images())).to.contain(imageA);
                    expect(Array.from(atlas.regions[1].images())).to.contain(imageB);
            }
        }

        expect(atlas.regions).to.have.length(2);

        expect(Array.from(atlas.regions[0].images())).to.have.members([imageA]);
        expect(Array.from(atlas.regions[1].images())).to.have.members([imageB, imageC, imageD]);
    });
});
