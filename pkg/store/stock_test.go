package store

import (
	"testing"

	"github.com/onestock/dp100ms/pkg/model"
)

func newTestStock() *Stock {
	skus := []model.SKU{{Code: "A"}, {Code: "B"}, {Code: "C"}}
	return NewStock(skus, []string{"P1", "P2", "P3"}, []int{1, 0, 0})
}

func TestPromisableAndBitmap(t *testing.T) {
	s := newTestStock()
	_ = s.Set("P1", "A", 3, 1, true)  // 3 - 1 reserved - 1 safety = 1
	_ = s.Set("P2", "A", 2, 2, true)  // 0
	_ = s.Set("P3", "A", 5, 0, false) // not listed
	l, _ := s.Line("P1", "A")
	if l.Available != 2 || l.Promisable != 1 {
		t.Fatalf("got %+v", l)
	}
	sn := s.Snapshot([]int32{0})
	if sn.Q(0, 0) != 1 || sn.Q(0, 1) != 0 || sn.Q(0, 2) != 0 {
		t.Fatalf("snapshot %v", sn.Qty)
	}
	if sn.Avail[0][0] != 1 {
		t.Fatalf("bitmap %b", sn.Avail[0][0])
	}
}

func TestApplyBatchAndVersion(t *testing.T) {
	s := newTestStock()
	v0 := s.Version()
	ten, neg := 10, -1
	applied, errs := s.Apply([]StockUpdate{
		{StockPointID: "P2", SKU: "B", Physical: &ten},
		{StockPointID: "PX", SKU: "B", Physical: &ten},
		{StockPointID: "P2", SKU: "B", Delta: &neg},
		{StockPointID: "P2", SKU: "C", Physical: &neg},
	})
	if applied != 2 || len(errs) != 2 {
		t.Fatalf("applied=%d errs=%v", applied, errs)
	}
	if s.Version() != v0+1 {
		t.Fatal("one batch must bump the version once")
	}
	l, _ := s.Line("P2", "B")
	if l.Physical != 9 {
		t.Fatalf("got %+v", l)
	}
}

func TestSetPointsKeepsQuantities(t *testing.T) {
	s := newTestStock()
	_ = s.Set("P3", "C", 7, 0, true)
	s.SetPoints([]string{"P1", "P2", "P3", "P4"}, []int{1, 0, 0, 0})
	l, _ := s.Line("P3", "C")
	if l.Physical != 7 {
		t.Fatal("quantities lost after adding a point")
	}
	s.SetPoints([]string{"P3", "P1"}, []int{0, 1}) // reorder / delete
	l, _ = s.Line("P3", "C")
	if l.Physical != 7 {
		t.Fatal("quantities lost after reordering")
	}
	if _, err := s.Line("P2", "C"); err == nil {
		t.Fatal("deleted point still present")
	}
}

func TestCollectionCRUD(t *testing.T) {
	st := New()
	v0 := st.ConfigVersion()
	if err := st.Carriers.Create(model.Carrier{ID: "X", Name: "X"}); err != nil {
		t.Fatal(err)
	}
	if err := st.Carriers.Create(model.Carrier{ID: "X"}); err != ErrConflict {
		t.Fatal("duplicate accepted")
	}
	if st.ConfigVersion() == v0 {
		t.Fatal("config version not bumped")
	}
	if err := st.Carriers.Update("Y", model.Carrier{ID: "Y"}); err != ErrNotFound {
		t.Fatal("update of a missing entity accepted")
	}
	items, total := st.Carriers.Page(nil, 0, 10)
	if total != 1 || len(items) != 1 {
		t.Fatal("page")
	}
	if err := st.Carriers.Delete("X"); err != nil || st.Carriers.Len() != 0 {
		t.Fatal("delete")
	}
}
