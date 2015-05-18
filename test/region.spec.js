import { Region } from '../lib/extra/atlas';

describe('Region', () => {

    let region;

    beforeEach(() => {
        region = new Region(0, 0, 100, 100);
    });

    it('has outer size 0x0 if no size specified', () => {
        region = new Region();

        expect(region.left).to.equal(0);
        expect(region.top).to.equal(0);
        expect(region.right).to.equal(0);
        expect(region.bottom).to.equal(0);

        expect(region.outerHeight).to.equal(0);
        expect(region.outerWidth).to.equal(0);
    });

    it('creates a region with specified bounds', () => {
        expect(region.left).to.equal(0);
        expect(region.top).to.equal(0);
        expect(region.right).to.equal(100);
        expect(region.bottom).to.equal(100);

        expect(region.outerHeight).to.equal(100);
        expect(region.outerWidth).to.equal(100);
    });

    it('succeeds to insert object smaller than region size', () => {
        expect(region.downRegion).to.not.exist;
        expect(region.rightRegion).to.not.exist;

        const image = { width: 50, height: 25 };
        const insertedRegion = region.insert(image);

        expect(insertedRegion).to.exist.and.to.equal(region);

        expect(insertedRegion.isFilled).to.be.true;
        expect(Array.from(region.images())).to.contain(image);

        expect(insertedRegion.innerWidth).to.equal(50);
        expect(insertedRegion.innerHeight).to.equal(25);

        expect(region.downRegion).to.exist;
        expect(region.rightRegion).to.exist;
    });

    it('succeeds to insert an image that fits the region perfectly', () => {
        region.insert({ width: region.outerWidth, height: region.outerHeight });

        expect(region.innerHeight).to.equal(region.outerHeight);
        expect(region.innerWidth).to.equal(region.outerWidth);
    });

    describe('Successful insertion splits new regions in direction of most available space', () => {

        it('splits vertically', () => {
            region.insert({ width: 50, height: 25 });

            expect(region.downRegion.outerHeight).to.equal(75, 'Wrong down region height');
            expect(region.downRegion.outerWidth).to.equal(50, 'Wrong down region width');

            expect(region.rightRegion.outerHeight).to.equal(100, 'Wrong right region height');
            expect(region.rightRegion.outerWidth).to.equal(50, 'Wrong right region height');
        });

        it('splits horizontally', () => {
            region.insert({ width: 25, height: 50 });

            expect(region.downRegion.outerHeight).to.equal(50, 'Wrong down region height');
            expect(region.downRegion.outerWidth).to.equal(100, 'Wrong down region width');

            expect(region.rightRegion.outerHeight).to.equal(50, 'Wrong right region height');
            expect(region.rightRegion.outerWidth).to.equal(75, 'Wrong right region height');
        });

    });

    it('fails to insert objects too large', () => {
        const insertedRegion = region.insert({ width: 150, height: 25 });
        expect(insertedRegion).to.not.exist;
    });

    it('finds the first available fitting region', () => {
        const firstInsert = region.insert({ width: 50, height: 25 });
        const secondInsert = region.insert({ width: 50, height: 25 });
        const thirdInsert = region.insert({ width: 100, height: 50 });

        expect(firstInsert).to.exist;
        expect(secondInsert).to.exist.and.to.equal(region.downRegion);
        expect(thirdInsert).to.not.exist
    });
});
